const esbuild = require('esbuild');
const isWatch = process.argv.includes('--watch');
const cfg = {
  entryPoints: ['src/extension.ts'],
  bundle: true, platform: 'node', external: ['vscode'],
  outdir: 'out', sourcemap: true, format: 'cjs', logLevel: 'info',
};
if (isWatch && typeof esbuild.context === 'function') {
  esbuild.context(cfg).then(ctx => ctx.watch()).then(() => console.log('Watching...'));
} else {
  esbuild.build(cfg).then(() => console.log('Build complete.')).catch(() => process.exit(1));
}
