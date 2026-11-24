/**
 * 自测专用 ESM 解析引导:注册 TS 解析钩子。
 * 用法: node --experimental-strip-types --import ./tools/ts-loader.mjs tools/selftest.ts
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[cm]?[jt]s$/.test(specifier)
    ) {
      const base = new URL(specifier, context.parentURL ?? pathToFileURL('./')).href;
      const tsPath = fileURLToPath(base + '.ts');
      if (existsSync(tsPath)) {
        return nextResolve(pathToFileURL(tsPath).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
