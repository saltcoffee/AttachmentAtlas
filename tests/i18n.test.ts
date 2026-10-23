import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { zh } from '../src/i18n/zh';
import { diagnostic, localeFor, translate } from '../src/i18n';
import {
  AtlasError,
  asMessage,
  errorDetail,
  message,
  renderMessage,
  type Text,
} from '../src/domain/messages';
import { digest, DEFAULT_SETTINGS } from '../src/domain/model';
import { scan } from '../src/application/scan';
import { settingsFrom } from '../src/infrastructure/settings';
import { MemoryVault, PNG } from './helpers';

describe('Obsidian language selection', () => {
  it.each(['zh', 'zh-CN', 'zh-TW', 'zh-Hans', 'zh-Hant', 'zh-HK', 'ZH_cn', ' zh '])(
    'shows Chinese for %s',
    (language) => {
      expect(localeFor(language)).toBe('zh-CN');
      expect(translate(language, 'Scan vault')).toBe('扫描当前库');
    },
  );
  it.each(['en', 'en-GB', 'fr', 'de', 'ja', 'ko', 'es', 'ar', 'unknown', 'zhx', ''])(
    'falls back to English for %s',
    (language) => {
      expect(localeFor(language)).toBe('en-US');
      expect(translate(language, 'Scan vault')).toBe('Scan vault');
      expect(translate(language, 'Recycle {count} images', { count: 3 })).toBe('Recycle 3 images');
    },
  );
});

describe('message boundaries and catalogue coverage', () => {
  it('translates nested diagnostics while preserving literal filenames and placeholder-like text', () => {
    const path = 'Scan vault/{count}/Image is referenced..png';
    const detail = message('Image cannot be recycled: {path}. {reason}', {
      path,
      reason: asMessage('Image is referenced.'),
    });
    expect(translate('zh', detail)).toBe(`无法回收图片：${path}。图片仍被引用。`);
    expect(translate('ja', detail)).toBe(`Image cannot be recycled: ${path}. Image is referenced.`);
    const error = new AtlasError(detail);
    expect(error.message).toBe(renderMessage(detail));
    expect(errorDetail(error)).toBe(detail);
    expect(diagnostic('zh', errorDetail(error))).toBe(translate('zh', detail));
  });
  it('preserves native error details with a localized explanation', () => {
    expect(diagnostic('zh', errorDetail(new Error('EACCES: images/{path}.png')))).toBe(
      '操作失败：EACCES: images/{path}.png',
    );
    expect(diagnostic('de', errorDetail(new Error('EACCES')))).toBe('EACCES');
    expect(diagnostic('zh', errorDetail(new Error('images/{toString}/{detail}.png')))).toBe(
      '操作失败：images/{toString}/{detail}.png',
    );
    for (const text of ['constructor', 'toString', '__proto__']) {
      expect(translate('zh', text)).toBe(text);
      expect(diagnostic('zh', text)).toBe(`操作失败：${text}`);
    }
  });
  it('translates invalid settings without exposing validator internals', () => {
    try {
      settingsFrom({ ...DEFAULT_SETTINGS, scope: '/outside' });
      throw new Error('Expected invalid settings to fail');
    } catch (error) {
      expect(diagnostic('zh', errorDetail(error))).toBe(
        '设置无效，请使用库内相对路径，受保护路径最多填写 100 条。',
      );
    }
  });
  it('keeps the same placeholders in both languages and uses English for every other language', () => {
    const placeholders = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    for (const [english, chinese] of Object.entries(zh)) {
      expect(placeholders(chinese), english).toEqual(placeholders(english));
      expect(translate('fr', english), english).toBe(english);
      if (english !== 'Attachment Atlas') expect(chinese, english).not.toBe(english);
    }
  });
  it('covers plugin messages and prevents untranslated UI literals from being introduced', () => {
    const root = fileURLToPath(new URL('../src/', import.meta.url));
    const templates = new Set<string>();
    const inspectText = (node: ts.Expression | undefined) => {
      if (!node) return;
      if (ts.isStringLiteral(node)) templates.add(node.text);
      else if (ts.isConditionalExpression(node)) {
        inspectText(node.whenTrue);
        inspectText(node.whenFalse);
      }
    };
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        const path = `${folder}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'i18n') walk(path);
          continue;
        }
        if (!path.endsWith('.ts')) continue;
        const source = ts.createSourceFile(
          path,
          readFileSync(path, 'utf8'),
          ts.ScriptTarget.Latest,
          true,
        );
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node)) {
            const name = node.expression.getText(source);
            if (['t', 'message'].includes(name)) inspectText(node.arguments[0]);
            if (name === 'assert') inspectText(node.arguments[1]);
            if (name === 'reasons.push') node.arguments.forEach(inspectText);
          }
          if (
            ts.isNewExpression(node) &&
            ['Error', 'AtlasError'].includes(node.expression.getText(source))
          )
            inspectText(node.arguments?.[0]);
          if (ts.isBinaryExpression(node) && node.left.getText(source) === 'this.status')
            inspectText(node.right);
          if (ts.isPropertyDeclaration(node) && node.name.getText(source) === 'status')
            inspectText(node.initializer);
          if (path.includes('/ui/')) {
            if (ts.isArrayLiteralExpression(node) && node.elements.length === 2) {
              const label = node.elements[1];
              if (label && ts.isStringLiteral(label) && /^[A-Z]/.test(label.text))
                inspectText(label);
            }
            if (
              ts.isPropertyAssignment(node) &&
              ts.isObjectLiteralExpression(node.parent) &&
              ts.isVariableDeclaration(node.parent.parent) &&
              node.parent.parent.name.getText(source) === 'names'
            )
              inspectText(node.initializer);
            if (
              ts.isPropertyAssignment(node) &&
              ['text', 'placeholder', 'aria-label'].includes(
                node.name.getText(source).replaceAll("'", ''),
              )
            ) {
              expect(ts.isStringLiteral(node.initializer), `${path}: raw UI text`).toBe(false);
            }
            if (ts.isTemplateExpression(node)) {
              for (const part of [
                node.head.text,
                ...node.templateSpans.map((span) => span.literal.text),
              ])
                expect(part, `${path}: raw template text`).not.toMatch(/[A-Za-z]{2,}/);
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    };
    walk(root);
    templates.delete('');
    expect([...templates].filter((template) => !Object.hasOwn(zh, template))).toEqual([]);
  });
  it('localizes actual scan blockers, image protection, and progress without mutating vault data', async () => {
    const vault = new MemoryVault({
      'Image is referenced..png': PNG,
      'note.md': '![[Image is referenced..png]]',
      'view.base': '',
    });
    const before = new Map(vault.files);
    const progress: Text[] = [];
    const result = await scan(vault, digest, {
      revision: 1,
      settings: DEFAULT_SETTINGS,
      progress: (text) => progress.push(text),
    });
    expect(translate('zh', result.blockers[0]!)).toBe('不支持的引用容器：view.base');
    expect(translate('de', result.blockers[0]!)).toBe('Unsupported reference container: view.base');
    expect(progress.map((text) => translate('zh', text)).join('\n')).toContain('正在检查');
    expect(progress.map((text) => translate('zh', text)).join('\n')).toContain(
      'Image is referenced..png',
    );
    expect(result.media[0]?.references).toHaveLength(1);
    expect(vault.files).toEqual(before);
    expect(vault.removed).toEqual([]);
  });
});
