/**
 * PagePlan extension registry.
 * Only developer-authored modules may register renderers. Model output can select a
 * registered type, but can never register code or supply executable handlers.
 */
const extensions = new Map();
const TYPE_RE = /^[a-z][a-z0-9-]{1,39}$/;
const BUILTIN_TYPES = new Set([
  'section', 'container', 'heading', 'text', 'image', 'link', 'card',
  'list', 'details', 'timeline', 'metric', 'callout', 'divider', 'quote', 'search', 'filter', 'tabs', 'scene3d',
]);

export function registerPagePlanRenderer(type, definition) {
  if (typeof type !== 'string' || !TYPE_RE.test(type)) {
    throw new TypeError('renderer type must be a lower-case kebab-case identifier');
  }
  if (BUILTIN_TYPES.has(type)) throw new Error(`cannot replace built-in renderer: ${type}`);
  if (extensions.has(type)) throw new Error(`renderer already registered: ${type}`);
  if (!definition || typeof definition.validate !== 'function' || typeof definition.render !== 'function') {
    throw new TypeError('renderer extension requires trusted validate(node) and render(node, context) functions');
  }
  extensions.set(type, Object.freeze({ validate: definition.validate, render: definition.render }));
  return () => extensions.delete(type);
}

export function getPagePlanRenderer(type) {
  return extensions.get(type) ?? null;
}

export function isBuiltinPagePlanType(type) {
  return BUILTIN_TYPES.has(type);
}

export function listExtensionPagePlanTypes() {
  return [...extensions.keys()].sort();
}
