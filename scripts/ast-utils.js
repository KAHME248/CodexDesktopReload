'use strict';
function walk(node, visitor) {
  if (!node || typeof node !== 'object') return;
  visitor(node);
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') {
          walk(item, visitor);
        }
      }
    } else if (child && typeof child.type === 'string') {
      walk(child, visitor);
    }
  }
}
module.exports = { walk };
