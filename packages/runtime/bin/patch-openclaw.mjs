// Installation hooks need source paths, not a configured inference runtime.
import { root } from '../src/host/paths.mjs';
import { applyOpenClawCompatibility } from '../../../scripts/openclaw-compat.mjs';
import { applyDependencySecurityPatches } from '../src/providers/dependency-security.mjs';
const dependencySecurity = applyDependencySecurityPatches(root);
console.log(
  dependencySecurity.changed
    ? 'Reviewed dependency security backports applied.'
    : 'Dependency security backports are current.',
);
console.log(
  applyOpenClawCompatibility(root)
    ? 'Reviewed OpenClaw compatibility fixes applied.'
    : 'OpenClaw compatibility fixes are current.',
);
