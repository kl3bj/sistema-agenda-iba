import React, { useState, useEffect, useMemo } from "react";
import { Plus, X, Calendar, Search, Check, Clock, CircleDollarSign, StickyNote, ChevronLeft, ChevronRight, Pencil, Trash2, Stethoscope, ClipboardList, Lock, Users, ShieldCheck } from "lucide-react";

const STORAGE_KEY = "clinica:consultas";
const DOCTORS_KEY = "clinica:medicos";
const PASSWORD_KEY = "clinica:senha";

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito", "Convênio", "Outro"];

const STATUS_STYLES = {
  pago: { label: "Pago", bg: "#E7F2EC", text: "#2F6F51", dot: "#3F8F65" },
  parcial: { label: "Falta parte", bg: "#FBF0DE", text: "#8A5A15", dot: "#D9932E" },
  pendente: { label: "Não pago", bg: "#FBE9E7", text: "#A03B2E", dot: "#C24A38" },
};

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDatePt(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function weekdayPt(iso) {
  const dias = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
  const d = new Date(iso + "T12:00:00");
  return dias[d.getDay()];
}

function emptyForm() {
  return {
    id: null,
    date: todayISO(),
    time: "09:00",
    clientName: "",
    doctorName: "",
    paymentMethod: FORMAS_PAGAMENTO[0],
    paymentStatus: "pendente",
    valorTotal: "",
    valorPago: "",
    notes: "",
  };
}

export default function App() {
  const [role, setRole] = useState(null); // 'secretaria' | 'chefe'
  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [passwordStored, setPasswordStored] = useState(undefined); // undefined = ainda não sei, null = não existe, string = existe
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [showAllDates, setShowAllDates] = useState(false);
  const [doctorFilter, setDoctorFilter] = useState("todos");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [passwordModal, setPasswordModal] = useState(null); // 'create' | 'enter' | 'change' | null
  const [doctorManagerOpen, setDoctorManagerOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [apptRes, docRes, pwdRes] = await Promise.allSettled([
        window.storage.get(STORAGE_KEY, true),
        window.storage.get(DOCTORS_KEY, true),
        window.storage.get(PASSWORD_KEY, true),
      ]);
      if (!mounted) return;
      setAppointments(apptRes.status === "fulfilled" && apptRes.value ? JSON.parse(apptRes.value.value) : []);
      setDoctors(docRes.status === "fulfilled" && docRes.value ? JSON.parse(docRes.value.value) : []);
      setPasswordStored(pwdRes.status === "fulfilled" && pwdRes.value ? pwdRes.value.value : null);
      setLoadingInitial(false);
    })();
    return () => { mounted = false; };
  }, []);

  async function persist(next) {
    setSaving(true);
    setError(null);
    try {
      const result = await window.storage.set(STORAGE_KEY, JSON.stringify(next), true);
      if (!result) throw new Error("sem resultado");
      setAppointments(next);
    } catch (e) {
      setError("Não foi possível salvar agora. Verifique a internet e tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  async function persistDoctors(next) {
    setSaving(true);
    setError(null);
    try {
      const result = await window.storage.set(DOCTORS_KEY, JSON.stringify(next), true);
      if (!result) throw new Error("sem resultado");
      setDoctors(next);
    } catch (e) {
      setError("Não foi possível salvar os médicos agora. Tente de novo.");
    } finally {
      setSaving(false);
    }
  }

  async function savePassword(pwd) {
    const result = await window.storage.set(PASSWORD_KEY, pwd, true);
    if (!result) throw new Error("sem resultado");
    setPasswordStored(pwd);
  }

  function addDoctor(name) {
    const clean = name.trim();
    if (!clean) return;
    if (doctors.some((d) => d.toLowerCase() === clean.toLowerCase())) return;
    persistDoctors([...doctors, clean]);
  }

  function removeDoctor(name) {
    persistDoctors(doctors.filter((d) => d !== name));
  }

  function openNewForm(dateForNew) {
    setForm({ ...emptyForm(), date: dateForNew || selectedDate, doctorName: doctors[0] || "" });
    setFormOpen(true);
  }

  function openEditForm(appt) {
    setForm({
      id: appt.id,
      date: appt.date,
      time: appt.time,
      clientName: appt.clientName,
      doctorName: appt.doctorName || "",
      paymentMethod: appt.paymentMethod,
      paymentStatus: appt.paymentStatus,
      valorTotal: appt.valorTotal ?? "",
      valorPago: appt.valorPago ?? "",
      notes: appt.notes ?? "",
    });
    setFormOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.clientName.trim() || !form.date || !form.time || !form.doctorName) return;
    const record = { ...form, id: form.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)) };
    let next;
    if (form.id) {
      next = appointments.map((a) => (a.id === form.id ? record : a));
    } else {
      next = [...appointments, record];
    }
    persist(next);
    setFormOpen(false);
  }

  function handleDelete(id) {
    const next = appointments.filter((a) => a.id !== id);
    persist(next);
    setConfirmDelete(null);
  }

  const filtered = useMemo(() => {
    let list = [...appointments];
    if (!showAllDates) list = list.filter((a) => a.date === selectedDate);
    if (doctorFilter !== "todos") list = list.filter((a) => a.doctorName === doctorFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.clientName.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return list;
  }, [appointments, selectedDate, showAllDates, search, doctorFilter]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const a of filtered) {
      if (!map.has(a.date)) map.set(a.date, []);
      map.get(a.date).push(a);
    }
    return Array.from(map.entries());
  }, [filtered]);

  function shiftDate(days) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
    setShowAllDates(false);
  }

  function requestSecretariaAccess() {
    if (passwordStored) {
      setPasswordModal("enter");
    } else {
      setPasswordModal("create");
    }
  }

  const isSecretaria = role === "secretaria";

  return (
    <div style={styles.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        .btn { cursor: pointer; border: none; font-family: inherit; transition: transform .08s ease, opacity .15s ease; }
        .btn:active { transform: scale(0.97); }
        .btn:focus-visible, .tap:focus-visible { outline: 2px solid #2F6F63; outline-offset: 2px; }
        input, select, textarea { font-family: inherit; }
        ::-webkit-scrollbar { width: 8px; }
      `}</style>

      {loadingInitial ? (
        <div style={styles.roleWrap}>
          <span style={{ color: "#8A8A82", fontSize: 14 }}>Carregando...</span>
        </div>
      ) : role === null ? (
        <RoleSelect onSelectSecretaria={requestSecretariaAccess} onSelectChefe={() => setRole("chefe")} />
      ) : (
        <div style={styles.shell}>
          <Header
            role={role}
            onSwitchRole={() => setRole(null)}
            saving={saving}
            onOpenDoctors={() => setDoctorManagerOpen(true)}
            onOpenPassword={() => setPasswordModal("change")}
          />

          {error && <div style={styles.errorBanner}>{error}</div>}

          <div style={styles.toolbar}>
            <div style={styles.dateNav}>
              <button className="btn tap" style={styles.iconBtn} onClick={() => shiftDate(-1)} aria-label="Dia anterior">
                <ChevronLeft size={18} color="#2F6F63" />
              </button>
              <button
                className="btn tap"
                style={{ ...styles.dateChip, ...(showAllDates ? styles.dateChipInactive : {}) }}
                onClick={() => { setSelectedDate(todayISO()); setShowAllDates(false); }}
              >
                <Calendar size={15} color="#2F6F63" />
                <span style={{ textTransform: "capitalize" }}>
                  {showAllDates ? "escolher dia" : `${formatDatePt(selectedDate)} · ${weekdayPt(selectedDate)}`}
                </span>
              </button>
              <button className="btn tap" style={styles.iconBtn} onClick={() => shiftDate(1)} aria-label="Próximo dia">
                <ChevronRight size={18} color="#2F6F63" />
              </button>
            </div>
            <button
              className="btn tap"
              style={{ ...styles.pill, ...(showAllDates ? styles.pillActive : {}) }}
              onClick={() => setShowAllDates((v) => !v)}
            >
              {showAllDates ? "Ver só o dia" : "Ver todas as datas"}
            </button>
          </div>

          {doctors.length > 0 && (
            <div style={styles.searchRow}>
              <Stethoscope size={15} color="#8A8A82" />
              <select
                style={{ ...styles.searchInput, cursor: "pointer" }}
                value={doctorFilter}
                onChange={(e) => setDoctorFilter(e.target.value)}
              >
                <option value="todos">Todos os médicos</option>
                {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}

          <div style={styles.searchRow}>
            <Search size={16} color="#8A8A82" />
            <input
              style={styles.searchInput}
              placeholder="Buscar cliente pelo nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={styles.list}>
            {grouped.length === 0 ? (
              <div style={styles.emptyState}>
                <ClipboardList size={28} color="#B9B6A9" />
                <p style={{ margin: "10px 0 4px", fontWeight: 600, color: "#54524A" }}>Nenhuma consulta aqui ainda</p>
                {isSecretaria && (
                  <p style={{ margin: 0, fontSize: 13, color: "#8A8A82" }}>
                    Toque em "Nova consulta" para marcar a primeira.
                  </p>
                )}
              </div>
            ) : (
              grouped.map(([date, items]) => (
                <div key={date} style={{ marginBottom: 18 }}>
                  {showAllDates && (
                    <div style={styles.dateHeader}>
                      <span style={{ textTransform: "capitalize" }}>{weekdayPt(date)}, {formatDatePt(date)}</span>
                      {date === todayISO() && <span style={styles.todayTag}>HOJE</span>}
                    </div>
                  )}
                  {items.map((a) => (
                    <AppointmentCard
                      key={a.id}
                      appt={a}
                      editable={isSecretaria}
                      onEdit={() => openEditForm(a)}
                      onDelete={() => setConfirmDelete(a.id)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

          {isSecretaria && (
            <button
              className="btn tap"
              style={styles.fab}
              onClick={() => (doctors.length === 0 ? setDoctorManagerOpen(true) : openNewForm())}
            >
              <Plus size={20} color="#fff" />
              <span>Nova consulta</span>
            </button>
          )}
        </div>
      )}

      {formOpen && (
        <FormModal
          form={form}
          setForm={setForm}
          doctors={doctors}
          onClose={() => setFormOpen(false)}
          onSubmit={handleSubmit}
          isEditing={!!form.id}
          onOpenDoctorManager={() => { setFormOpen(false); setDoctorManagerOpen(true); }}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}

      {doctorManagerOpen && (
        <DoctorManagerModal
          doctors={doctors}
          onAdd={addDoctor}
          onRemove={removeDoctor}
          onClose={() => setDoctorManagerOpen(false)}
        />
      )}

      {passwordModal && (
        <PasswordModal
          mode={passwordModal}
          onClose={() => setPasswordModal(null)}
          onCreate={async (pwd) => {
            await savePassword(pwd);
            setPasswordModal(null);
            setRole("secretaria");
          }}
          onEnter={(pwd) => {
            if (pwd === passwordStored) {
              setPasswordModal(null);
              setRole("secretaria");
              return true;
            }
            return false;
          }}
          onChange={async (oldPwd, newPwd) => {
            if (oldPwd !== passwordStored) return false;
            await savePassword(newPwd);
            setPasswordModal(null);
            return true;
          }}
        />
      )}
    </div>
  );
}

function RoleSelect({ onSelectSecretaria, onSelectChefe }) {
  return (
    <div style={styles.roleWrap}>
      <div style={styles.roleCard}>
        <Stethoscope size={30} color="#2F6F63" />
        <h1 style={styles.roleTitle}>Agenda da clínica</h1>
        <p style={styles.roleSubtitle}>Quem está entrando agora?</p>
        <button className="btn tap" style={styles.roleBtnPrimary} onClick={onSelectSecretaria}>
          Sou a secretária
        </button>
        <button className="btn tap" style={styles.roleBtnSecondary} onClick={onSelectChefe}>
          Agenda do médico
        </button>
      </div>
    </div>
  );
}

function Header({ role, onSwitchRole, saving, onOpenDoctors, onOpenPassword }) {
  return (
    <div style={styles.header}>
      <div>
        <div style={styles.headerEyebrow}>{role === "secretaria" ? "Modo secretária" : "Agenda do médico · somente leitura"}</div>
        <h1 style={styles.headerTitle}>Agenda da clínica</h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {saving && <span style={styles.savingTag}>salvando...</span>}
        {role === "secretaria" && (
          <>
            <button className="btn tap" style={styles.iconBtn} onClick={onOpenDoctors} aria-label="Gerenciar médicos">
              <Users size={16} color="#5B5A52" />
            </button>
            <button className="btn tap" style={styles.iconBtn} onClick={onOpenPassword} aria-label="Trocar senha">
              <Lock size={16} color="#5B5A52" />
            </button>
          </>
        )}
        <button className="btn tap" style={styles.switchBtn} onClick={onSwitchRole}>trocar</button>
      </div>
    </div>
  );
}

function AppointmentCard({ appt, editable, onEdit, onDelete }) {
  const st = STATUS_STYLES[appt.paymentStatus] || STATUS_STYLES.pendente;
  return (
    <div style={styles.card}>
      <div style={styles.cardTime}>
        <Clock size={14} color="#2F6F63" />
        <span>{appt.time}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={styles.cardName}>{appt.clientName}</div>
        <div style={styles.cardMetaRow}>
          <span style={{ ...styles.statusBadge, background: st.bg, color: st.text }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: st.dot, display: "inline-block" }} />
            {st.label}
          </span>
          {appt.doctorName && (
            <span style={styles.cardMetaItem}>
              <Stethoscope size={13} color="#8A8A82" /> {appt.doctorName}
            </span>
          )}
          <span style={styles.cardMetaItem}>
            <CircleDollarSign size={13} color="#8A8A82" /> {appt.paymentMethod}
          </span>
        </div>
        {appt.notes && (
          <div style={styles.cardNotes}>
            <StickyNote size={12} color="#B0AD9F" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{appt.notes}</span>
          </div>
        )}
      </div>
      {editable && (
        <div style={styles.cardActions}>
          <button className="btn tap" style={styles.smallIconBtn} onClick={onEdit} aria-label="Editar">
            <Pencil size={15} color="#5B5A52" />
          </button>
          <button className="btn tap" style={styles.smallIconBtn} onClick={onDelete} aria-label="Excluir">
            <Trash2 size={15} color="#B04A3B" />
          </button>
        </div>
      )}
    </div>
  );
}

function FormModal({ form, setForm, doctors, onClose, onSubmit, isEditing, onOpenDoctorManager }) {
  function upd(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>{isEditing ? "Editar consulta" : "Nova consulta"}</h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>

        {doctors.length === 0 ? (
          <div style={{ padding: "6px 18px 24px" }}>
            <p style={{ fontSize: 13.5, color: "#8A8A82", marginBottom: 12 }}>
              Cadastre pelo menos um médico antes de marcar consultas.
            </p>
            <button type="button" className="btn tap" style={styles.submitBtn} onClick={onOpenDoctorManager}>
              Cadastrar médico
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={styles.form}>
            <label style={styles.label}>
              Nome do cliente
              <input
                style={styles.input}
                value={form.clientName}
                onChange={(e) => upd("clientName", e.target.value)}
                required
                placeholder="Ex: Maria da Silva"
              />
            </label>

            <label style={styles.label}>
              Médico que vai atender
              <select style={styles.input} value={form.doctorName} onChange={(e) => upd("doctorName", e.target.value)} required>
                <option value="" disabled>Selecione o médico</option>
                {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>

            <div style={styles.row2}>
              <label style={styles.label}>
                Data
                <input type="date" style={styles.input} value={form.date} onChange={(e) => upd("date", e.target.value)} required />
              </label>
              <label style={styles.label}>
                Horário
                <input type="time" style={styles.input} value={form.time} onChange={(e) => upd("time", e.target.value)} required />
              </label>
            </div>

            <label style={styles.label}>
              Forma de pagamento
              <select style={styles.input} value={form.paymentMethod} onChange={(e) => upd("paymentMethod", e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>

            <label style={styles.label}>
              Situação do pagamento
              <div style={styles.statusOptions}>
                {Object.entries(STATUS_STYLES).map(([key, s]) => (
                  <button
                    type="button"
                    key={key}
                    className="btn tap"
                    onClick={() => upd("paymentStatus", key)}
                    style={{
                      ...styles.statusOption,
                      background: form.paymentStatus === key ? s.bg : "#fff",
                      color: form.paymentStatus === key ? s.text : "#8A8A82",
                      borderColor: form.paymentStatus === key ? s.dot : "#E3E1D9",
                    }}
                  >
                    {form.paymentStatus === key && <Check size={13} />}
                    {s.label}
                  </button>
                ))}
              </div>
            </label>

            {form.paymentStatus !== "pago" && (
              <div style={styles.row2}>
                <label style={styles.label}>
                  Valor total (R$)
                  <input
                    type="number" min="0" step="0.01"
                    style={styles.input}
                    value={form.valorTotal}
                    onChange={(e) => upd("valorTotal", e.target.value)}
                    placeholder="0,00"
                  />
                </label>
                <label style={styles.label}>
                  Valor já pago (R$)
                  <input
                    type="number" min="0" step="0.01"
                    style={styles.input}
                    value={form.valorPago}
                    onChange={(e) => upd("valorPago", e.target.value)}
                    placeholder="0,00"
                  />
                </label>
              </div>
            )}

            <label style={styles.label}>
              Anotações
              <textarea
                style={{ ...styles.input, minHeight: 70, resize: "vertical" }}
                value={form.notes}
                onChange={(e) => upd("notes", e.target.value)}
                placeholder="Observações sobre a consulta..."
              />
            </label>

            <button type="submit" className="btn tap" style={styles.submitBtn}>
              {isEditing ? "Salvar alterações" : "Marcar consulta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({ onCancel, onConfirm }) {
  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={{ ...styles.modal, maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "22px 20px" }}>
          <p style={{ margin: "0 0 18px", fontSize: 15, color: "#3A3934" }}>Excluir esta consulta da agenda? Essa ação não pode ser desfeita.</p>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn tap" style={styles.cancelBtn} onClick={onCancel}>Cancelar</button>
            <button className="btn tap" style={styles.deleteBtn} onClick={onConfirm}>Excluir</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DoctorManagerModal({ doctors, onAdd, onRemove, onClose }) {
  const [name, setName] = useState("");
  function submit(e) {
    e.preventDefault();
    onAdd(name);
    setName("");
  }
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Médicos da clínica</h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>
        <div style={{ padding: "6px 18px 22px" }}>
          {doctors.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#8A8A82", marginBottom: 14 }}>Nenhum médico cadastrado ainda.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {doctors.map((d) => (
                <div key={d} style={styles.doctorRow}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14.5, fontWeight: 600, color: "#233B34" }}>
                    <Stethoscope size={15} color="#2F6F63" /> {d}
                  </span>
                  <button className="btn tap" style={styles.smallIconBtn} onClick={() => onRemove(d)} aria-label="Remover">
                    <Trash2 size={15} color="#B04A3B" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...styles.input, flex: 1 }}
              placeholder="Nome do novo médico"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn tap" style={styles.addDoctorBtn}>
              <Plus size={16} color="#fff" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function PasswordModal({ mode, onClose, onCreate, onEnter, onChange }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [oldPwd, setOldPwd] = useState("");
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (mode === "create") {
      if (pwd.length < 4) return setErr("Use uma senha com pelo menos 4 caracteres.");
      if (pwd !== pwd2) return setErr("As senhas não coincidem.");
      await onCreate(pwd);
    } else if (mode === "enter") {
      const ok = onEnter(pwd);
      if (!ok) setErr("Senha incorreta. Tente de novo.");
    } else if (mode === "change") {
      if (pwd.length < 4) return setErr("A nova senha precisa de pelo menos 4 caracteres.");
      if (pwd !== pwd2) return setErr("As senhas novas não coincidem.");
      const ok = await onChange(oldPwd, pwd);
      if (!ok) setErr("Senha atual incorreta.");
    }
  }

  const titles = {
    create: "Criar senha da secretária",
    enter: "Digite a senha",
    change: "Trocar senha",
  };

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={19} color="#2F6F63" /> {titles[mode]}
            </span>
          </h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          {mode === "create" && (
            <p style={{ fontSize: 13, color: "#8A8A82", margin: "-4px 0 4px" }}>
              É a primeira vez aqui. Crie uma senha para proteger o acesso da secretária.
            </p>
          )}
          {mode === "change" && (
            <label style={styles.label}>
              Senha atual
              <input type="password" style={styles.input} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} required />
            </label>
          )}
          {mode === "enter" ? (
            <label style={styles.label}>
              Senha
              <input type="password" style={styles.input} value={pwd} onChange={(e) => setPwd(e.target.value)} required autoFocus />
            </label>
          ) : (
            <>
              <label style={styles.label}>
                {mode === "change" ? "Nova senha" : "Senha"}
                <input type="password" style={styles.input} value={pwd} onChange={(e) => setPwd(e.target.value)} required />
              </label>
              <label style={styles.label}>
                Confirmar senha
                <input type="password" style={styles.input} value={pwd2} onChange={(e) => setPwd2(e.target.value)} required />
              </label>
            </>
          )}
          {err && <div style={styles.errorBanner}>{err}</div>}
          <button type="submit" className="btn tap" style={styles.submitBtn}>
            {mode === "create" ? "Criar e entrar" : mode === "enter" ? "Entrar" : "Salvar nova senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

const FONT_DISPLAY = "'Fraunces', serif";
const FONT_BODY = "'Inter', system-ui, sans-serif";

const styles = {
  page: { minHeight: "100vh", background: "#FAF9F5", fontFamily: FONT_BODY, color: "#2B2A26" },
  shell: { maxWidth: 640, margin: "0 auto", padding: "18px 14px 100px" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 },
  headerEyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: "#7A9B8E" },
  headerTitle: { fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, margin: "2px 0 0", color: "#233B34" },
  savingTag: { fontSize: 11, color: "#8A8A82" },
  switchBtn: { background: "#fff", border: "1px solid #E3E1D9", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, color: "#5B5A52" },
  errorBanner: { background: "#FBE9E7", color: "#A03B2E", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" },
  dateNav: { display: "flex", alignItems: "center", gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 9, background: "#fff", border: "1px solid #E3E1D9", display: "flex", alignItems: "center", justifyContent: "center" },
  dateChip: { display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, fontWeight: 600, color: "#233B34" },
  dateChipInactive: { opacity: 0.55 },
  pill: { background: "#fff", border: "1px solid #E3E1D9", borderRadius: 99, padding: "7px 13px", fontSize: 12.5, color: "#5B5A52" },
  pillActive: { background: "#233B34", color: "#fff", borderColor: "#233B34" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 14, background: "transparent" },
  list: { display: "flex", flexDirection: "column", marginTop: 6 },
  dateHeader: { display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "#7A9B8E", marginBottom: 8, paddingLeft: 2 },
  todayTag: { background: "#233B34", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 7px", borderRadius: 5 },
  emptyState: { textAlign: "center", padding: "48px 20px", color: "#8A8A82", fontSize: 14 },
  card: { display: "flex", gap: 12, background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "13px 14px", marginBottom: 9, alignItems: "flex-start" },
  cardTime: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 700, color: "#233B34", paddingTop: 2, minWidth: 44 },
  cardName: { fontWeight: 700, fontSize: 15.5, color: "#233B34", marginBottom: 5 },
  cardMetaRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  statusBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99 },
  cardMetaItem: { display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "#8A8A82" },
  cardNotes: { display: "flex", gap: 6, marginTop: 7, fontSize: 12.5, color: "#7A796F", lineHeight: 1.4 },
  cardActions: { display: "flex", flexDirection: "column", gap: 6 },
  smallIconBtn: { width: 28, height: 28, borderRadius: 7, background: "#F7F6F1", border: "1px solid #ECEAE1", display: "flex", alignItems: "center", justifyContent: "center" },
  fab: { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "#2F6F63", color: "#fff", border: "none", borderRadius: 99, padding: "14px 22px", fontSize: 14.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(47,111,99,0.35)" },
  roleWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  roleCard: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 18, padding: "32px 26px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 12px 32px rgba(35,59,52,0.08)" },
  roleTitle: { fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: "#233B34", margin: "12px 0 4px" },
  roleSubtitle: { fontSize: 13.5, color: "#8A8A82", margin: "0 0 22px" },
  roleBtnPrimary: { width: "100%", background: "#2F6F63", color: "#fff", border: "none", borderRadius: 11, padding: "13px 16px", fontSize: 14.5, fontWeight: 700, marginBottom: 10 },
  roleBtnSecondary: { width: "100%", background: "#fff", color: "#233B34", border: "1px solid #E3E1D9", borderRadius: 11, padding: "13px 16px", fontSize: 14.5, fontWeight: 600 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(35,40,36,0.45)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50 },
  modal: { background: "#fff", width: "100%", maxWidth: 480, borderRadius: "18px 18px 0 0", maxHeight: "90vh", overflowY: "auto" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 6px" },
  modalTitle: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, color: "#233B34", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: 13, padding: "10px 18px 24px" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#5B5A52" },
  input: { border: "1px solid #E3E1D9", borderRadius: 9, padding: "11px 12px", fontSize: 14.5, color: "#2B2A26", background: "#FDFCFA" },
  row2: { display: "flex", gap: 10 },
  statusOptions: { display: "flex", gap: 8, flexWrap: "wrap" },
  statusOption: { display: "flex", alignItems: "center", gap: 5, border: "1.5px solid", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 },
  submitBtn: { background: "#233B34", color: "#fff", border: "none", borderRadius: 11, padding: "14px 16px", fontSize: 15, fontWeight: 700, marginTop: 6 },
  cancelBtn: { flex: 1, background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 600, color: "#5B5A52" },
  deleteBtn: { flex: 1, background: "#C24A38", color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 700 },
  doctorRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FAF9F5", border: "1px solid #ECEAE1", borderRadius: 9, padding: "9px 12px" },
  addDoctorBtn: { width: 44, background: "#2F6F63", border: "none", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" },
};
