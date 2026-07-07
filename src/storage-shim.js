// Este arquivo conecta o sistema ao banco de dados real (Supabase),
// permitindo que a secretária e o médico vejam a mesma agenda
// atualizada, em qualquer aparelho.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json",
};

window.storage = {
  async get(key) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}&select=value`,
      { headers: baseHeaders }
    );
    if (!res.ok) throw new Error("Erro ao buscar dados no banco.");
    const rows = await res.json();
    if (!rows.length) return null;
    return { key, value: rows[0].value, shared: true };
  },

  async set(key, value) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store`, {
      method: "POST",
      headers: { ...baseHeaders, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error("Erro ao salvar dados no banco.");
    return { key, value, shared: true };
  },

  async delete(key) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/kv_store?key=eq.${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: baseHeaders,
    });
    if (!res.ok) throw new Error("Erro ao remover dados no banco.");
    return { key, deleted: true, shared: true };
  },

  async list(prefix = "") {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/kv_store?key=like.${encodeURIComponent(prefix)}*&select=key`,
      { headers: baseHeaders }
    );
    if (!res.ok) throw new Error("Erro ao listar dados no banco.");
    const rows = await res.json();
    return { keys: rows.map((r) => r.key), prefix, shared: true };
  },
};
