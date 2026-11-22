import React from 'react';
import { createRoot } from 'react-dom/client';
import type { ThemeName } from '../../../../packages/ui/src/theme/themes.js';
import type { ConnState } from '../main/daemon.js';
import { App } from './App.js';

const params = new URLSearchParams(location.search);
const theme = params.get('theme') as ThemeName | null;
const conn = params.get('conn') as ConnState | null;
const screen = params.get('screen');

createRoot(document.getElementById('root') as HTMLElement).render(
  React.createElement(App, { forcedConn: conn, initialTheme: theme ?? undefined, forcedScreen: screen }),
);
