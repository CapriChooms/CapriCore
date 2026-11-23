#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
import { createRequire } from 'node:module';
import { ensureDesktopIdentity } from '../src/host/desktop-identity.mjs';
console.log(await ensureDesktopIdentity(createRequire(import.meta.url)('electron')));
