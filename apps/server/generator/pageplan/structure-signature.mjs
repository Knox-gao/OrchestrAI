/** Structural-only signature for controlled direction experiments. Excludes text, IDs, and theme. */
export function pagePlanStructureSignature(plan) {
  if (!plan || !Array.isArray(plan.nodes)) throw new TypeError('plan.nodes is required');
  const visit = (nodes) => nodes.map((node) => {
    const shape = { type: node.type };
    for (const key of ['layout', 'columns', 'variant', 'level']) if (node[key] != null) shape[key] = node[key];
    if (node.type === 'tabs') shape.panels = node.panels.map((panel) => visit(panel.children));
    else if (Array.isArray(node.children)) shape.children = visit(node.children);
    if (node.type === 'filter') shape.optionCount = node.options.length;
    if (node.type === 'scene3d') shape.shapeCounts = node.objects.reduce((acc, object) => { acc[object.shape] = (acc[object.shape] ?? 0) + 1; return acc; }, {});
    return shape;
  });
  return JSON.stringify(visit(plan.nodes));
}

export function comparePagePlanStructures(a, b) {
  const signatureA = pagePlanStructureSignature(a);
  const signatureB = pagePlanStructureSignature(b);
  return { same: signatureA === signatureB, signatureA, signatureB };
}
