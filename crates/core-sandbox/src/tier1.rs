//! Tier-1 Windows sandbox: Job Object + AppContainer (zero capabilities).
//!
//! One spawned tool process gets:
//! * a Job Object with `KILL_ON_JOB_CLOSE`, no breakaway allowance, and full
//!   UI restrictions, and
//! * an AppContainer token with ZERO capabilities (no network, no broad
//!   filesystem), plus an explicit DACL grant of the declared scope directory
//!   to the AppContainer SID.
//!
//! The Job handle is held by [`SandboxedChild`]; closing it (drop) kills the
//! whole job, so a dead parent cannot orphan a live child.

use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt as _;
use std::path::{Path, PathBuf};

use windows::Win32::Foundation::{
    CloseHandle, GENERIC_ALL, HANDLE, HLOCAL, LocalFree, WIN32_ERROR,
};
use windows::Win32::Security::Authorization::{
    EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT,
    SetEntriesInAclW, SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows::Win32::Security::{
    DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_CAPABILITIES,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_UILIMIT_DESKTOP, JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
    JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD,
    JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    JOBOBJECT_BASIC_LIMIT_INFORMATION, JOBOBJECT_BASIC_UI_RESTRICTIONS,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectBasicUIRestrictions,
    JobObjectExtendedLimitInformation, SetInformationJobObject, TerminateJobObject,
};
use windows::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION,
    ResumeThread, STARTUPINFOEXW, STARTUPINFOW, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject,
};
use windows::core::{PCWSTR, PWSTR};

use crate::SandboxError;

fn api_err(op: &'static str, detail: String) -> SandboxError {
    SandboxError::Api { op, detail }
}

fn win_err(op: &'static str, code: WIN32_ERROR) -> SandboxError {
    api_err(op, format!("WIN32_ERROR {} (0x{:08X})", code.0, code.0))
}

fn os_wide_null(s: &OsStr) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_wide().collect();
    v.push(0);
    v
}

fn str_wide_null(s: &str) -> Vec<u16> {
    let mut v: Vec<u16> = s.encode_utf16().collect();
    v.push(0);
    v
}

/// Append one argv element with MSVCRT quoting.
fn append_quoted(cmd: &mut String, arg: &str) {
    let needs_quote = arg.is_empty() || arg.contains([' ', '\t', '\n', '"']);
    if !needs_quote {
        cmd.push_str(arg);
        return;
    }
    cmd.push('"');
    let mut backslashes = 0usize;
    for ch in arg.chars() {
        if ch == '\\' {
            backslashes += 1;
        } else if ch == '"' {
            for _ in 0..backslashes * 2 + 1 {
                cmd.push('\\');
            }
            cmd.push('"');
            backslashes = 0;
        } else {
            for _ in 0..backslashes {
                cmd.push('\\');
            }
            backslashes = 0;
            cmd.push(ch);
        }
    }
    for _ in 0..backslashes * 2 {
        cmd.push('\\');
    }
    cmd.push('"');
}

fn build_command_line(program: &OsStr, args: &[&OsStr]) -> Vec<u16> {
    let prog = program.to_string_lossy();
    let mut cmd = String::new();
    append_quoted(&mut cmd, &prog);
    for a in args {
        cmd.push(' ');
        append_quoted(&mut cmd, &a.to_string_lossy());
    }
    cmd.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Resolve (creating when missing) the Tier-1 AppContainer SID.
///
/// Zero capabilities are requested: `CreateAppContainerProfile` is called
/// with a `None` capability list, so the profile cannot use the network or
/// broad filesystem locations.
fn appcontainer_sid() -> Result<PSID, SandboxError> {
    let name_w = str_wide_null(crate::PROFILE_NAME);
    // Existing profile: derive its SID.
    let derived = unsafe { DeriveAppContainerSidFromAppContainerName(PCWSTR(name_w.as_ptr())) };
    match derived {
        Ok(sid) => Ok(sid),
        Err(first) => {
            // Missing profile: create it with zero capabilities.
            let display_w = str_wide_null(crate::PROFILE_NAME);
            let desc_w = str_wide_null("Tier-1 tool sandbox (zero capabilities)");
            let created = unsafe {
                CreateAppContainerProfile(
                    PCWSTR(name_w.as_ptr()),
                    PCWSTR(display_w.as_ptr()),
                    PCWSTR(desc_w.as_ptr()),
                    None,
                )
            };
            match created {
                Ok(sid) => Ok(sid),
                Err(e) => Err(api_err(
                    "CreateAppContainerProfile",
                    format!(
                        "profile {:?}: first derive failed {first}; create failed {e} (0x{:08X})",
                        crate::PROFILE_NAME,
                        e.code().0 as u32
                    ),
                )),
            }
        }
    }
}

unsafe fn free_sid(sid: PSID) {
    if !sid.0.is_null() {
        unsafe {
            windows::Win32::Security::FreeSid(sid);
        }
    }
}

/// Grant the AppContainer SID full control over `scope_dir` (inheriting to
/// children), preserving the existing DACL.
fn grant_scope_access(scope_dir: &Path, sid: PSID) -> Result<(), SandboxError> {
    let path_w = os_wide_null(scope_dir.as_os_str());
    let mut old_dacl: *mut windows::Win32::Security::ACL = std::ptr::null_mut();
    let mut sd: PSECURITY_DESCRIPTOR = PSECURITY_DESCRIPTOR(std::ptr::null_mut());
    // SAFETY: path_w is null-terminated and lives through the call.
    let err: WIN32_ERROR = unsafe {
        GetNamedSecurityInfoW(
            PCWSTR(path_w.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            Some(&mut old_dacl),
            None,
            &mut sd,
        )
    };
    if err.0 != 0 {
        return Err(win_err("GetNamedSecurityInfoW", err));
    }
    // Build an inheriting GRANT_ACCESS entry for the AppContainer SID.
    let trustee = TRUSTEE_W {
        pMultipleTrustee: std::ptr::null_mut(),
        MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        ptstrName: PWSTR(sid.0 as *mut u16),
    };
    let ea = EXPLICIT_ACCESS_W {
        grfAccessPermissions: GENERIC_ALL.0,
        grfAccessMode: GRANT_ACCESS,
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: trustee,
    };
    let mut new_dacl: *mut windows::Win32::Security::ACL = std::ptr::null_mut();
    // SAFETY: `ea` borrows `sid`, which outlives this call.
    let err2: WIN32_ERROR = unsafe {
        let old_opt = if old_dacl.is_null() {
            None
        } else {
            Some(&*old_dacl as *const windows::Win32::Security::ACL)
        };
        SetEntriesInAclW(Some(&[ea]), old_opt, &mut new_dacl)
    };
    if err2.0 != 0 {
        unsafe {
            if !sd.0.is_null() {
                let _ = LocalFree(Some(HLOCAL(sd.0)));
            }
        }
        return Err(win_err("SetEntriesInAclW", err2));
    }
    // SAFETY: path_w + new_dacl live through the call.
    let err3: WIN32_ERROR = unsafe {
        SetNamedSecurityInfoW(
            PCWSTR(path_w.as_ptr()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            None,
            None,
            if new_dacl.is_null() {
                None
            } else {
                Some(&*new_dacl as *const windows::Win32::Security::ACL)
            },
            None,
        )
    };
    unsafe {
        if !sd.0.is_null() {
            let _ = LocalFree(Some(HLOCAL(sd.0)));
        }
        if !new_dacl.is_null() {
            let _ = LocalFree(Some(HLOCAL(new_dacl as *mut std::ffi::c_void)));
        }
    }
    if err3.0 != 0 {
        return Err(win_err("SetNamedSecurityInfoW", err3));
    }
    Ok(())
}

fn create_job() -> Result<HANDLE, SandboxError> {
    let job = unsafe { CreateJobObjectW(None, None) }.map_err(|e| {
        api_err(
            "CreateJobObjectW",
            format!("create job failed: {e} (0x{:08X})", e.code().0 as u32),
        )
    })?;
    // Extended limits: KILL_ON_JOB_CLOSE only (breakaway deliberately absent).
    let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
            LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            ..Default::default()
        },
        ..Default::default()
    };
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    }
    .map_err(|e| {
        unsafe {
            let _ = CloseHandle(job);
        }
        api_err(
            "SetInformationJobObject",
            format!(
                "JobObjectExtendedLimitInformation failed: {e} (0x{:08X})",
                e.code().0 as u32
            ),
        )
    })?;
    // UI restrictions: deny every job UI escape hatch.
    let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
        UIRestrictionsClass: JOB_OBJECT_UILIMIT_DESKTOP
            | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
            | JOB_OBJECT_UILIMIT_EXITWINDOWS
            | JOB_OBJECT_UILIMIT_GLOBALATOMS
            | JOB_OBJECT_UILIMIT_HANDLES
            | JOB_OBJECT_UILIMIT_READCLIPBOARD
            | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
            | JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    };
    unsafe {
        SetInformationJobObject(
            job,
            JobObjectBasicUIRestrictions,
            &ui as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
        )
    }
    .map_err(|e| {
        unsafe {
            let _ = CloseHandle(job);
        }
        api_err(
            "SetInformationJobObject",
            format!(
                "JobObjectBasicUIRestrictions failed: {e} (0x{:08X})",
                e.code().0 as u32
            ),
        )
    })?;
    Ok(job)
}

/// A live Tier-1 child. Holds the Job (kills the tree on close), the process
/// and the primary thread. Dropping closes all three handles.
pub struct SandboxedChild {
    job: HANDLE,
    process: HANDLE,
    thread: HANDLE,
    pid: u32,
    scope_dir: PathBuf,
}

impl SandboxedChild {
    /// OS process id of the confined child.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// Scope directory this child was granted.
    pub fn scope_dir(&self) -> &Path {
        &self.scope_dir
    }

    /// Raw Job handle (for `IsProcessInJob` probes in tests).
    pub fn job_handle(&self) -> HANDLE {
        self.job
    }

    /// Raw process handle (for wait probes in tests).
    pub fn process_handle(&self) -> HANDLE {
        self.process
    }

    /// `true` while the child has not exited (`STILL_ACTIVE` = 259).
    pub fn is_alive(&self) -> bool {
        let mut code: u32 = 0;
        let ok = unsafe { GetExitCodeProcess(self.process, &mut code) };
        ok.is_ok() && code == 259
    }

    /// `true` when the child process is a member of this job.
    pub fn is_in_job(&self) -> bool {
        let mut in_job = windows::core::BOOL(0);
        unsafe {
            IsProcessInJob(self.process, Some(self.job), &mut in_job).is_ok() && in_job.0 != 0
        }
    }

    /// Wait up to `timeout_ms` for exit. Returns `Some(code)` on exit,
    /// `None` on timeout.
    pub fn wait_timeout(&self, timeout_ms: u32) -> Result<Option<u32>, SandboxError> {
        let ev = unsafe { WaitForSingleObject(self.process, timeout_ms) };
        if ev.0 == 0 {
            let mut code: u32 = 0;
            unsafe { GetExitCodeProcess(self.process, &mut code) }.map_err(|e| {
                api_err(
                    "GetExitCodeProcess",
                    format!("after wait: {e} (0x{:08X})", e.code().0 as u32),
                )
            })?;
            Ok(Some(code))
        } else if ev.0 == 258 {
            Ok(None)
        } else {
            Err(api_err(
                "WaitForSingleObject",
                format!("unexpected wait result {}", ev.0),
            ))
        }
    }

    /// Wait forever for exit and return the exit code.
    pub fn wait(&self) -> Result<u32, SandboxError> {
        let ev = unsafe { WaitForSingleObject(self.process, INFINITE) };
        if ev.0 != 0 {
            return Err(api_err(
                "WaitForSingleObject",
                format!("infinite wait failed: {}", ev.0),
            ));
        }
        let mut code: u32 = 0;
        unsafe { GetExitCodeProcess(self.process, &mut code) }.map_err(|e| {
            api_err(
                "GetExitCodeProcess",
                format!("after wait: {e} (0x{:08X})", e.code().0 as u32),
            )
        })?;
        Ok(code)
    }

    /// Kill the whole job tree.
    pub fn kill(&self) -> Result<(), SandboxError> {
        // Prefer the job kill (whole tree); fall back to the process.
        let job_kill = unsafe { TerminateJobObject(self.job, 1) };
        if job_kill.is_ok() {
            return Ok(());
        }
        unsafe { TerminateProcess(self.process, 1) }.map_err(|e| {
            api_err(
                "TerminateProcess",
                format!(
                    "job + process kill failed: {e} (0x{:08X})",
                    e.code().0 as u32
                ),
            )
        })
    }
}

impl Drop for SandboxedChild {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.thread);
            let _ = CloseHandle(self.process);
            // Closing the last Job handle kills the tree (KILL_ON_JOB_CLOSE).
            let _ = CloseHandle(self.job);
        }
    }
}

// SAFETY: Job/process/thread handles are kernel objects; moving the owner
// across threads does not alias mutable state.
unsafe impl Send for SandboxedChild {}

/// Spawn `program` + `args` confined to Tier-1, with `scope_dir` as the
/// working directory and the only explicitly granted filesystem location.
pub fn spawn(
    scope_dir: &Path,
    program: &OsStr,
    args: &[&OsStr],
) -> Result<SandboxedChild, SandboxError> {
    std::fs::create_dir_all(scope_dir).map_err(|e| SandboxError::Io {
        path: scope_dir.display().to_string(),
        source: e,
    })?;
    // Absolute path for the ACL + child cwd. NOTE: `canonicalize` returns a
    // `\\?\`-prefixed verbatim path that CreateProcessW rejects as the child
    // working directory (FILE_NOT_FOUND), so absolutize without resolving.
    let scope_abs: PathBuf =
        std::path::absolute(scope_dir).unwrap_or_else(|_| scope_dir.to_path_buf());

    // 1) AppContainer identity (zero capabilities).
    let sid = appcontainer_sid()?;

    // 2) DACL grant of the scope dir to that SID.
    let grant = grant_scope_access(&scope_abs, sid);
    if let Err(e) = grant {
        unsafe { free_sid(sid) };
        return Err(e);
    }

    // 3) Job Object with Tier-1 limits.
    let job = match create_job() {
        Ok(j) => j,
        Err(e) => {
            unsafe { free_sid(sid) };
            return Err(e);
        }
    };

    // 4) Spawn suspended inside the AppContainer.
    let result = spawn_in_appcontainer(&scope_abs, program, args, sid, job);
    // The SID copy in SECURITY_CAPABILITIES is no longer needed after
    // CreateProcessW returns; the DACL grant persists on disk.
    unsafe { free_sid(sid) };
    match result {
        Ok((process, thread, pid)) => Ok(SandboxedChild {
            job,
            process,
            thread,
            pid,
            scope_dir: scope_abs,
        }),
        Err(e) => {
            unsafe {
                let _ = CloseHandle(job);
            }
            Err(e)
        }
    }
}

fn spawn_in_appcontainer(
    scope_abs: &Path,
    program: &OsStr,
    args: &[&OsStr],
    sid: PSID,
    job: HANDLE,
) -> Result<(HANDLE, HANDLE, u32), SandboxError> {
    // SECURITY_CAPABILITIES with zero capabilities.
    let mut caps = SECURITY_CAPABILITIES {
        AppContainerSid: sid,
        Capabilities: std::ptr::null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };
    // Attribute list for exactly one attribute.
    let mut size: usize = 0;
    unsafe {
        let _ = InitializeProcThreadAttributeList(None, 1, None, &mut size);
    }
    if size == 0 {
        return Err(api_err(
            "InitializeProcThreadAttributeList",
            "size probe returned 0".to_string(),
        ));
    }
    let mut buf = vec![0u8; size];
    let attr_list = LPPROC_THREAD_ATTRIBUTE_LIST(buf.as_mut_ptr() as *mut std::ffi::c_void);
    unsafe {
        InitializeProcThreadAttributeList(Some(attr_list), 1, None, &mut size).map_err(|e| {
            api_err(
                "InitializeProcThreadAttributeList",
                format!("init failed: {e} (0x{:08X})", e.code().0 as u32),
            )
        })?;
    }
    // From here every early return must free the attribute list.
    let update = unsafe {
        UpdateProcThreadAttribute(
            attr_list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            Some(&mut caps as *mut _ as *const std::ffi::c_void),
            std::mem::size_of::<SECURITY_CAPABILITIES>(),
            None,
            None,
        )
    };
    if let Err(e) = update {
        unsafe {
            DeleteProcThreadAttributeList(attr_list);
        }
        return Err(api_err(
            "UpdateProcThreadAttribute",
            format!(
                "SECURITY_CAPABILITIES failed: {e} (0x{:08X})",
                e.code().0 as u32
            ),
        ));
    }

    let mut cmdline = build_command_line(program, args);
    let scope_w = os_wide_null(scope_abs.as_os_str());
    let mut si_ex = STARTUPINFOEXW {
        StartupInfo: STARTUPINFOW {
            cb: std::mem::size_of::<STARTUPINFOEXW>() as u32,
            ..Default::default()
        },
        lpAttributeList: attr_list,
    };
    // For CreateProcessW the StartupInfo.cb must be the EX size and the
    // attribute list pointer must sit in lpAttributeList.
    si_ex.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
    let mut pi = PROCESS_INFORMATION::default();
    let flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW;
    // SAFETY: cmdline + scope_w + attr_list live through the call; `caps`
    // borrows the still-valid `sid`.
    let created = unsafe {
        CreateProcessW(
            PCWSTR::null(),
            Some(PWSTR(cmdline.as_mut_ptr())),
            None,
            None,
            false,
            flags,
            None,
            PCWSTR(scope_w.as_ptr()),
            &si_ex.StartupInfo as *const STARTUPINFOW as *const _,
            &mut pi,
        )
    };
    unsafe {
        DeleteProcThreadAttributeList(attr_list);
    }
    // `buf` drops here; the child already copied what it needs.
    if let Err(e) = created {
        return Err(api_err(
            "CreateProcessW",
            format!(
                "AppContainer spawn failed (is AppContainer available on this host?): {e} (0x{:08X})",
                e.code().0 as u32
            ),
        ));
    }
    // Assign to the Job BEFORE resuming (suspended start closes the race).
    let assigned = unsafe { AssignProcessToJobObject(job, pi.hProcess) };
    if let Err(e) = assigned {
        unsafe {
            let _ = TerminateProcess(pi.hProcess, 1);
            let _ = CloseHandle(pi.hThread);
            let _ = CloseHandle(pi.hProcess);
        }
        return Err(api_err(
            "AssignProcessToJobObject",
            format!("assign failed: {e} (0x{:08X})", e.code().0 as u32),
        ));
    }
    // Go.
    unsafe {
        ResumeThread(pi.hThread);
    }
    Ok((pi.hProcess, pi.hThread, pi.dwProcessId))
}
