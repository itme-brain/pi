// Files whose current contents are known in this session. Shared by the edit
// and overwrite guards so a successful Read unlocks either mutation strategy.
export const knownFiles = new Set<string>();
