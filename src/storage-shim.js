// Este arquivo "simula" a função window.storage que só existe dentro
// do ambiente do Claude, para que o sistema funcione normalmente
// quando publicado fora dele (ex: no Vercel).
//
// IMPORTANTE: por enquanto os dados ficam salvos apenas no navegador
// de cada aparelho (localStorage). Isso é uma solução temporária até
// conectarmos um banco de dados real (ex: Supabase), que vai permitir
// que todos vejam a mesma agenda atualizada em tempo real.

function buildKey(key, shared) {
  return `agenda-clinica:${shared ? "shared" : "local"}:${key}`;
}

window.storage = {
  async get(key, shared = false) {
    const raw = localStorage.getItem(buildKey(key, shared));
    if (raw === null) return null;
    return { key, value: raw, shared };
  },

  async set(key, value, shared = false) {
    localStorage.setItem(buildKey(key, shared), value);
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    const existed = localStorage.getItem(buildKey(key, shared)) !== null;
    localStorage.removeItem(buildKey(key, shared));
    return { key, deleted: existed, shared };
  },

  async list(prefix = "", shared = false) {
    const fullPrefix = buildKey(prefix, shared);
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(fullPrefix)) {
        keys.push(k.replace(`agenda-clinica:${shared ? "shared" : "local"}:`, ""));
      }
    }
    return { keys, prefix, shared };
  },
};
