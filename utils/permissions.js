function mergePermissions(permissionSets = []) {
  const merged = {};
  for (const permissions of permissionSets) {
    for (const [screenId, actions] of Object.entries(permissions || {})) {
      if (!merged[screenId]) merged[screenId] = { view:false, insert:false, edit:false, delete:false };
      for (const action of ["view", "insert", "edit", "delete"]) {
        merged[screenId][action] = merged[screenId][action] || !!actions?.[action];
      }
    }
  }
  return merged;
}

module.exports = { mergePermissions };
