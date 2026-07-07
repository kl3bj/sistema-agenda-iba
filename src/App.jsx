import React, { useState, useEffect, useMemo } from "react";
import { Plus, X, Calendar, Search, Check, Clock, CircleDollarSign, StickyNote, ChevronLeft, ChevronRight, ChevronDown, Pencil, Trash2, Stethoscope, ClipboardList, Lock, Users, ShieldCheck, Bell, AlertTriangle, RefreshCw, Ban, PieChart, Download, FileText, ArrowLeft } from "lucide-react";
import jsPDF from "jspdf";
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "clinica:consultas";
const DOCTORS_KEY = "clinica:medicos";
const PASSWORD_KEY = "clinica:senha";

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito", "Convênio", "Outro"];

const TIPOS_CONSULTA = ["Consulta", "Retorno", "Avaliação", "Exame", "Procedimento", "Encaixe/Urgência"];

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
    appointmentType: TIPOS_CONSULTA[0],
    paymentMethod: FORMAS_PAGAMENTO[0],
    paymentStatus: "pendente",
    valorTotal: "",
    valorPago: "",
    convenioName: "",
    notes: "",
  };
}

export default function App() {
  const [role, setRole] = useState(null); // 'secretaria' | 'chefe'
  const [appointments, setAppointments] = useState([]);
  const [doctors, setDoctors] = useState([]);
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
  const [passwordModal, setPasswordModal] = useState(null); // 'change' | null
  const [doctorManagerOpen, setDoctorManagerOpen] = useState(false);
  const [doctorPickerOpen, setDoctorPickerOpen] = useState(false);
  const [selectedDoctorView, setSelectedDoctorView] = useState(null);
  const [requestModalFor, setRequestModalFor] = useState(null); // id da consulta (médico solicitando)
  const [resolveModalFor, setResolveModalFor] = useState(null); // id da consulta (secretária resolvendo)
  const [financeiroOpen, setFinanceiroOpen] = useState(false);

  // Autenticação da secretária (Supabase Auth)
  const [session, setSession] = useState(undefined); // undefined = carregando, null = deslogada, objeto = logada
  const [secretaryName, setSecretaryName] = useState("");
  const [authView, setAuthView] = useState(null); // null | 'login' | 'signup' | 'forgot' | 'sent'
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setSecretaryName(data.session?.user?.user_metadata?.name || "");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        return;
      }
      setSession(newSession);
      setSecretaryName(newSession?.user?.user_metadata?.name || "");
      if (!newSession) setRole((r) => (r === "secretaria" ? null : r));
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadAll(showLoading) {
      const [apptRes, docRes] = await Promise.allSettled([
        window.storage.get(STORAGE_KEY, true),
        window.storage.get(DOCTORS_KEY, true),
      ]);
      if (!mounted) return;
      setAppointments(apptRes.status === "fulfilled" && apptRes.value ? JSON.parse(apptRes.value.value) : []);
      setDoctors(docRes.status === "fulfilled" && docRes.value ? JSON.parse(docRes.value.value) : []);
      if (showLoading) setLoadingInitial(false);
    }

    loadAll(true);
    // Verifica atualizações a cada 5 segundos, assim a secretária e o médico
    // veem as mudanças um do outro sem precisar recarregar a página.
    const interval = setInterval(() => loadAll(false), 5000);
    return () => { mounted = false; clearInterval(interval); };
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

  async function changePassword(oldPwd, newPwd) {
    const email = session?.user?.email;
    if (!email) return false;
    const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: oldPwd });
    if (reauthErr) return false;
    const { error: updateErr } = await supabase.auth.updateUser({ password: newPwd });
    return !updateErr;
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
      appointmentType: appt.appointmentType || TIPOS_CONSULTA[0],
      paymentMethod: appt.paymentMethod,
      paymentStatus: appt.paymentStatus,
      valorTotal: appt.valorTotal ?? "",
      valorPago: appt.valorPago ?? "",
      convenioName: appt.convenioName ?? "",
      notes: appt.notes ?? "",
    });
    setFormOpen(true);
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!form.clientName.trim() || !form.date || !form.time || !form.doctorName) return;
    const hasConflict = appointments.some(
      (a) =>
        a.id !== form.id &&
        !a.cancelled &&
        a.doctorName === form.doctorName &&
        a.date === form.date &&
        a.time === form.time
    );
    if (hasConflict) return;
    const valorPagoFinal =
      form.paymentStatus === "pago" ? form.valorTotal : form.paymentStatus === "pendente" ? "0" : form.valorPago;
    const record = {
      ...form,
      valorPago: valorPagoFinal,
      id: form.id || (Date.now().toString(36) + Math.random().toString(36).slice(2)),
      createdBy: form.id ? (appointments.find((a) => a.id === form.id)?.createdBy || secretaryName) : secretaryName,
      lastEditedBy: secretaryName,
    };
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

  function submitDoctorRequest(id, type, reason) {
    const next = appointments.map((a) =>
      a.id === id ? { ...a, requestPending: { type, reason, requestedAt: new Date().toISOString() } } : a
    );
    persist(next);
    setRequestModalFor(null);
  }

  function confirmCancelRequest(id) {
    const next = appointments.map((a) => {
      if (a.id !== id) return a;
      const reason = a.requestPending?.reason || "";
      return {
        ...a,
        cancelled: true,
        requestPending: null,
        resolution: { type: "cancelada", reason, resolvedAt: new Date().toISOString() },
        doctorNotice: { type: "cancelada" },
      };
    });
    persist(next);
    setResolveModalFor(null);
  }

  function confirmRescheduleRequest(id, newDate, newTime) {
    const next = appointments.map((a) => {
      if (a.id !== id) return a;
      const reason = a.requestPending?.reason || "";
      return {
        ...a,
        date: newDate,
        time: newTime,
        requestPending: null,
        resolution: { type: "remarcada", reason, resolvedAt: new Date().toISOString() },
        doctorNotice: { type: "remarcada", newDate, newTime },
      };
    });
    persist(next);
    setResolveModalFor(null);
  }

  function discardRequest(id) {
    const next = appointments.map((a) => (a.id === id ? { ...a, requestPending: null } : a));
    persist(next);
    setResolveModalFor(null);
  }

  function dismissDoctorNotice(id) {
    const next = appointments.map((a) => (a.id === id ? { ...a, doctorNotice: null } : a));
    persist(next);
  }

  const filtered = useMemo(() => {
    let list = [...appointments];
    if (role === "chefe") {
      list = list.filter((a) => a.doctorName === selectedDoctorView && (!a.cancelled || a.doctorNotice));
    } else if (doctorFilter !== "todos") {
      list = list.filter((a) => a.doctorName === doctorFilter);
    }
    if (!showAllDates) list = list.filter((a) => a.date === selectedDate);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.clientName.toLowerCase().includes(q));
    }
    list.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return list;
  }, [appointments, selectedDate, showAllDates, search, doctorFilter, role, selectedDoctorView]);

  const pendingRequestsCount = useMemo(
    () => appointments.filter((a) => a.requestPending).length,
    [appointments]
  );

  const doctorNoticesCount = useMemo(
    () => appointments.filter((a) => a.doctorName === selectedDoctorView && a.doctorNotice).length,
    [appointments, selectedDoctorView]
  );

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
    if (session) {
      setRole("secretaria");
    } else {
      setAuthView("login");
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

      {recoveryMode ? (
        <ResetPasswordScreen
          onDone={async () => {
            await supabase.auth.signOut();
            setRecoveryMode(false);
            setRole(null);
            setAuthView("login");
          }}
        />
      ) : loadingInitial || session === undefined ? (
        <div style={styles.roleWrap}>
          <span style={{ color: "#8A8A82", fontSize: 14 }}>Carregando...</span>
        </div>
      ) : authView ? (
        <SecretariaAuthScreen
          view={authView}
          setView={setAuthView}
          onSuccess={() => {
            setAuthView(null);
            setRole("secretaria");
          }}
          onCancel={() => setAuthView(null)}
        />
      ) : doctorPickerOpen ? (
        <DoctorPickerScreen
          doctors={doctors}
          onSelect={(name) => {
            setSelectedDoctorView(name);
            setRole("chefe");
            setDoctorPickerOpen(false);
          }}
          onBack={() => {
            setDoctorPickerOpen(false);
            setRole(null);
            setSelectedDoctorView(null);
          }}
        />
      ) : role === null ? (
        <RoleSelect onSelectSecretaria={requestSecretariaAccess} onSelectChefe={() => setDoctorPickerOpen(true)} />
      ) : (
        <div style={styles.shell}>
          <Header
            role={role}
            selectedDoctorView={selectedDoctorView}
            secretaryName={secretaryName}
            onSwitchRole={async () => {
              if (role === "secretaria") await supabase.auth.signOut();
              setRole(null);
              setSelectedDoctorView(null);
              setDoctorPickerOpen(false);
              setFinanceiroOpen(false);
            }}
            onSwitchDoctor={() => setDoctorPickerOpen(true)}
            saving={saving}
            onOpenDoctors={() => setDoctorManagerOpen(true)}
            onOpenPassword={() => setPasswordModal("change")}
            onOpenFinanceiro={() => setFinanceiroOpen(true)}
            financeiroOpen={financeiroOpen}
            appointments={appointments}
            selectedDoctorViewForBell={selectedDoctorView}
            onOpenResolveFromBell={(id) => setResolveModalFor(id)}
            onDismissNoticeFromBell={(id) => dismissDoctorNotice(id)}
          />

          {error && <div style={styles.errorBanner}>{error}</div>}

          {financeiroOpen ? (
            <FinanceiroScreen
              appointments={appointments}
              doctors={doctors}
              role={role}
              selectedDoctorView={selectedDoctorView}
              onBack={() => setFinanceiroOpen(false)}
            />
          ) : (
            <>
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

          {role === "secretaria" && doctors.length > 0 && (
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
                      role={role}
                      editable={isSecretaria}
                      onEdit={() => openEditForm(a)}
                      onDelete={() => setConfirmDelete(a.id)}
                      onRequestAction={() => setRequestModalFor(a.id)}
                      onOpenResolve={() => setResolveModalFor(a.id)}
                      onDismissNotice={() => dismissDoctorNotice(a.id)}
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
            </>
          )}
        </div>
      )}

      {formOpen && (
        <FormModal
          form={form}
          setForm={setForm}
          doctors={doctors}
          appointments={appointments}
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

      {requestModalFor && (
        <RequestActionModal
          appt={appointments.find((a) => a.id === requestModalFor)}
          onClose={() => setRequestModalFor(null)}
          onSubmit={submitDoctorRequest}
        />
      )}

      {resolveModalFor && (
        <ResolveRequestModal
          appt={appointments.find((a) => a.id === resolveModalFor)}
          onClose={() => setResolveModalFor(null)}
          onConfirmCancel={confirmCancelRequest}
          onConfirmReschedule={confirmRescheduleRequest}
          onDiscard={discardRequest}
        />
      )}

      {passwordModal && (
        <PasswordModal
          mode={passwordModal}
          onClose={() => setPasswordModal(null)}
          onChange={async (oldPwd, newPwd) => {
            const ok = await changePassword(oldPwd, newPwd);
            if (ok) setPasswordModal(null);
            return ok;
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

function Header({
  role,
  selectedDoctorView,
  secretaryName,
  onSwitchRole,
  onSwitchDoctor,
  saving,
  onOpenDoctors,
  onOpenPassword,
  onOpenFinanceiro,
  financeiroOpen,
  appointments,
  selectedDoctorViewForBell,
  onOpenResolveFromBell,
  onDismissNoticeFromBell,
}) {
  const [notifOpen, setNotifOpen] = useState(false);

  const notifItems =
    role === "secretaria"
      ? appointments.filter((a) => a.requestPending).map((a) => ({ kind: "pending", appt: a }))
      : appointments.filter((a) => a.doctorName === selectedDoctorViewForBell && a.doctorNotice).map((a) => ({ kind: "notice", appt: a }));

  return (
    <div style={styles.header}>
      <div>
        <div style={styles.headerEyebrow}>
          {role === "secretaria" ? `Modo secretária${secretaryName ? ` · ${secretaryName}` : ""}` : "Agenda do médico"}
        </div>
        <h1 style={styles.headerTitle}>
          {role === "chefe" ? `Agenda do Doutor(a) ${selectedDoctorView}` : "Agenda da clínica"}
        </h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        {saving && <span style={styles.savingTag}>salvando...</span>}

        <button
          className="btn tap"
          style={{ ...styles.iconBtn, ...(financeiroOpen ? styles.iconBtnActive : {}) }}
          onClick={onOpenFinanceiro}
          aria-label="Financeiro"
        >
          <PieChart size={16} color={financeiroOpen ? "#fff" : "#5B5A52"} />
        </button>

        {role === "secretaria" && (
          <button className="btn tap" style={styles.iconBtn} onClick={onOpenDoctors} aria-label="Gerenciar médicos">
            <Users size={16} color="#5B5A52" />
          </button>
        )}

        <div style={{ position: "relative" }}>
          <button className="btn tap" style={styles.iconBtn} onClick={() => setNotifOpen((v) => !v)} aria-label="Notificações">
            <Bell size={16} color="#5B5A52" />
            {notifItems.length > 0 && <span style={styles.bellDot}>{notifItems.length}</span>}
          </button>
          {notifOpen && (
            <div style={styles.notifDropdown}>
              <div style={styles.notifDropdownHeader}>
                <span>Notificações</span>
                <button className="btn tap" onClick={() => setNotifOpen(false)} aria-label="Fechar">
                  <X size={15} color="#8A8A82" />
                </button>
              </div>
              {notifItems.length === 0 ? (
                <div style={styles.emptyNotif}>Nenhuma notificação por aqui.</div>
              ) : (
                notifItems.map(({ kind, appt }) => (
                  <div key={appt.id} style={styles.notifItem}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: "#233B34" }}>{appt.clientName}</div>
                    <div style={{ fontSize: 11.5, color: "#8A8A82", marginBottom: 4 }}>
                      {formatDatePt(appt.date)} às {appt.time}
                    </div>
                    {kind === "pending" ? (
                      <>
                        <div style={{ fontSize: 12, color: "#8A5A15" }}>
                          Pediu {appt.requestPending.type === "cancelamento" ? "cancelamento" : "remarcação"}: "{appt.requestPending.reason}"
                        </div>
                        <button
                          className="btn tap"
                          style={styles.notifActionBtn}
                          onClick={() => {
                            onOpenResolveFromBell(appt.id);
                            setNotifOpen(false);
                          }}
                        >
                          Analisar
                        </button>
                      </>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: "#2F6F63" }}>
                          {appt.doctorNotice.type === "cancelada"
                            ? "Seu pedido de cancelamento foi confirmado."
                            : `Remarcada para ${formatDatePt(appt.doctorNotice.newDate)} às ${appt.doctorNotice.newTime}.`}
                        </div>
                        <button
                          className="btn tap"
                          style={styles.notifActionBtn}
                          onClick={() => onDismissNoticeFromBell(appt.id)}
                        >
                          OK, entendi
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {role === "secretaria" && (
          <button className="btn tap" style={styles.iconBtn} onClick={onOpenPassword} aria-label="Trocar senha">
            <Lock size={16} color="#5B5A52" />
          </button>
        )}
        {role === "chefe" && (
          <button className="btn tap" style={styles.switchBtn} onClick={onSwitchDoctor}>trocar médico</button>
        )}
        <button className="btn tap" style={styles.switchBtn} onClick={onSwitchRole}>trocar</button>
      </div>
    </div>
  );
}

function DoctorPickerScreen({ doctors, onSelect, onBack }) {
  return (
    <div style={styles.roleWrap}>
      <div style={styles.roleCard}>
        <Stethoscope size={30} color="#2F6F63" />
        <h1 style={styles.roleTitle}>Agenda do médico</h1>
        <p style={styles.roleSubtitle}>
          {doctors.length === 0 ? "Nenhum médico cadastrado ainda. Peça para a secretária cadastrar." : "Qual é o seu nome?"}
        </p>
        {doctors.map((d) => (
          <button
            key={d}
            className="btn tap"
            style={{ ...styles.roleBtnSecondary, marginBottom: 10 }}
            onClick={() => onSelect(d)}
          >
            {d}
          </button>
        ))}
        <button className="btn tap" style={{ ...styles.switchBtn, marginTop: 6 }} onClick={onBack}>voltar</button>
      </div>
    </div>
  );
}

function AppointmentCard({ appt, role, editable, onEdit, onDelete, onRequestAction, onOpenResolve, onDismissNotice }) {
  const [expanded, setExpanded] = useState(false);
  const st = STATUS_STYLES[appt.paymentStatus] || STATUS_STYLES.pendente;

  let cardStyle = styles.card;
  if (appt.cancelled) cardStyle = { ...styles.card, ...styles.cardCancelled };
  else if (appt.requestPending) cardStyle = { ...styles.card, ...styles.cardPending };

  return (
    <div style={cardStyle}>
      <div style={styles.cardTime}>
        <Clock size={14} color="#2F6F63" />
        <span>{appt.time}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}
          onClick={() => setExpanded((v) => !v)}
        >
          <div style={styles.cardName}>{appt.clientName}</div>
          <ChevronDown
            size={16}
            color="#B0AD9F"
            style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}
          />
        </div>
        <div style={styles.cardMetaRow}>
          <span style={styles.typeBadge}>
            <ClipboardList size={11} color="#2F6F63" /> {appt.appointmentType || "Consulta"}
          </span>
          <span style={{ ...styles.statusBadge, background: st.bg, color: st.text }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: st.dot, display: "inline-block" }} />
            {st.label}
          </span>
          {appt.doctorName && role !== "chefe" && (
            <span style={styles.cardMetaItem}>
              <Stethoscope size={13} color="#8A8A82" /> {appt.doctorName}
            </span>
          )}
          <span style={styles.cardMetaItem}>
            <CircleDollarSign size={13} color="#8A8A82" /> {appt.paymentMethod}
          </span>
        </div>

        {expanded && (
          <div style={styles.expandPanel}>
            <div style={styles.expandRow}><span>Valor total</span><strong>{appt.valorTotal ? `R$ ${appt.valorTotal}` : "—"}</strong></div>
            <div style={styles.expandRow}><span>Valor já pago</span><strong>{appt.valorPago ? `R$ ${appt.valorPago}` : "—"}</strong></div>
            {appt.paymentMethod === "Convênio" && (
              <div style={styles.expandRow}><span>Convênio</span><strong>{appt.convenioName || "—"}</strong></div>
            )}
            {role === "secretaria" && appt.createdBy && (
              <div style={styles.expandRow}><span>Cadastrado por</span><strong>{appt.createdBy}</strong></div>
            )}
          </div>
        )}

        {appt.notes && (
          <div style={styles.cardNotes}>
            <StickyNote size={12} color="#B0AD9F" style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{appt.notes}</span>
          </div>
        )}

        {appt.requestPending && role === "secretaria" && (
          <div style={styles.inlineNotice}>
            <AlertTriangle size={14} color="#8A5A15" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Médico solicitou <strong>{appt.requestPending.type === "cancelamento" ? "cancelamento" : "remarcação"}</strong>: "{appt.requestPending.reason}"
            </span>
          </div>
        )}
        {appt.requestPending && role === "secretaria" && (
          <button className="btn tap" style={styles.resolveBtn} onClick={onOpenResolve}>Analisar solicitação</button>
        )}

        {appt.requestPending && role === "chefe" && (
          <div style={styles.inlineNotice}>
            <Clock size={14} color="#8A5A15" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Aguardando retorno da secretária sobre sua solicitação.</span>
          </div>
        )}

        {appt.cancelled && appt.resolution && role === "secretaria" && (
          <div style={{ ...styles.inlineNotice, ...styles.inlineNoticeDanger }}>
            <Ban size={14} color="#A03B2E" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>Cancelada a pedido do médico. Motivo: "{appt.resolution.reason}"</span>
          </div>
        )}

        {appt.doctorNotice && role === "chefe" && (
          <div style={{ ...styles.inlineNotice, ...styles.inlineNoticeInfo }}>
            <Bell size={14} color="#2F6F63" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              {appt.doctorNotice.type === "cancelada"
                ? "Sua solicitação de cancelamento foi confirmada pela secretária."
                : `Sua solicitação de remarcação foi confirmada. Nova data: ${formatDatePt(appt.doctorNotice.newDate)} às ${appt.doctorNotice.newTime}.`}
              <button className="btn tap" style={styles.noticeOkBtn} onClick={onDismissNotice}>OK, entendi</button>
            </span>
          </div>
        )}

        {role === "chefe" && !appt.requestPending && !appt.cancelled && (
          <button className="btn tap" style={styles.requestActionBtn} onClick={onRequestAction}>
            <RefreshCw size={13} color="#5B5A52" /> Solicitar cancelamento ou remarcação
          </button>
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

function RequestActionModal({ appt, onClose, onSubmit }) {
  const [type, setType] = useState("cancelamento");
  const [reason, setReason] = useState("");

  function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return;
    onSubmit(appt.id, type, reason.trim());
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Solicitar à secretária</h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          <p style={{ fontSize: 13, color: "#8A8A82", margin: "-4px 0 0" }}>
            Consulta de <strong>{appt?.clientName}</strong> em {appt && formatDatePt(appt.date)} às {appt?.time}.
          </p>
          <label style={styles.label}>
            O que você quer solicitar?
            <div style={styles.statusOptions}>
              <button
                type="button"
                className="btn tap"
                onClick={() => setType("cancelamento")}
                style={{
                  ...styles.statusOption,
                  background: type === "cancelamento" ? "#FBE9E7" : "#fff",
                  color: type === "cancelamento" ? "#A03B2E" : "#8A8A82",
                  borderColor: type === "cancelamento" ? "#C24A38" : "#E3E1D9",
                }}
              >
                <Ban size={13} /> Cancelar
              </button>
              <button
                type="button"
                className="btn tap"
                onClick={() => setType("remarcacao")}
                style={{
                  ...styles.statusOption,
                  background: type === "remarcacao" ? "#FBF0DE" : "#fff",
                  color: type === "remarcacao" ? "#8A5A15" : "#8A8A82",
                  borderColor: type === "remarcacao" ? "#D9932E" : "#E3E1D9",
                }}
              >
                <RefreshCw size={13} /> Remarcar
              </button>
            </div>
          </label>
          <label style={styles.label}>
            Motivo (a secretária vai ver essa mensagem)
            <textarea
              style={{ ...styles.input, minHeight: 80, resize: "vertical" }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex: Tive uma emergência e preciso remarcar para outro dia..."
              required
            />
          </label>
          <button type="submit" className="btn tap" style={styles.submitBtn}>Enviar solicitação</button>
        </form>
      </div>
    </div>
  );
}

function ResolveRequestModal({ appt, onClose, onConfirmCancel, onConfirmReschedule, onDiscard }) {
  const [newDate, setNewDate] = useState(appt?.date || todayISO());
  const [newTime, setNewTime] = useState(appt?.time || "09:00");
  if (!appt || !appt.requestPending) return null;
  const isCancel = appt.requestPending.type === "cancelamento";

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Solicitação do médico</h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>
        <div style={styles.form}>
          <p style={{ fontSize: 13.5, color: "#5B5A52", margin: 0 }}>
            <strong>{appt.clientName}</strong> · {appt.doctorName} · {formatDatePt(appt.date)} às {appt.time}
          </p>
          <div style={{ ...styles.inlineNotice, ...styles.inlineNoticeStatic }}>
            <AlertTriangle size={14} color="#8A5A15" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Pedido de <strong>{isCancel ? "cancelamento" : "remarcação"}</strong>: "{appt.requestPending.reason}"
            </span>
          </div>

          {isCancel ? (
            <button className="btn tap" style={styles.deleteBtn} onClick={() => onConfirmCancel(appt.id)}>
              Confirmar cancelamento
            </button>
          ) : (
            <>
              <div style={styles.row2}>
                <label style={styles.label}>
                  Nova data
                  <input type="date" style={styles.input} value={newDate} onChange={(e) => setNewDate(e.target.value)} />
                </label>
                <label style={styles.label}>
                  Novo horário
                  <input type="time" style={styles.input} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
                </label>
              </div>
              <button
                className="btn tap"
                style={styles.submitBtn}
                onClick={() => onConfirmReschedule(appt.id, newDate, newTime)}
              >
                Confirmar nova data e notificar médico
              </button>
            </>
          )}
          <button className="btn tap" style={styles.cancelBtn} onClick={() => onDiscard(appt.id)}>
            Descartar solicitação (manter como estava)
          </button>
        </div>
      </div>
    </div>
  );
}

function FormModal({ form, setForm, doctors, appointments, onClose, onSubmit, isEditing, onOpenDoctorManager }) {
  function upd(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const conflict = useMemo(() => {
    if (!form.doctorName || !form.date || !form.time) return null;
    return appointments.find(
      (a) =>
        a.id !== form.id &&
        !a.cancelled &&
        a.doctorName === form.doctorName &&
        a.date === form.date &&
        a.time === form.time
    );
  }, [appointments, form.id, form.doctorName, form.date, form.time]);

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
              Tipo de consulta
              <select style={styles.input} value={form.appointmentType} onChange={(e) => upd("appointmentType", e.target.value)}>
                {TIPOS_CONSULTA.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
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
                <input
                  type="date"
                  style={{ ...styles.input, ...(conflict ? styles.inputConflict : {}) }}
                  value={form.date}
                  onChange={(e) => upd("date", e.target.value)}
                  required
                />
              </label>
              <label style={styles.label}>
                Horário
                <input
                  type="time"
                  style={{ ...styles.input, ...(conflict ? styles.inputConflict : {}) }}
                  value={form.time}
                  onChange={(e) => upd("time", e.target.value)}
                  required
                />
              </label>
            </div>

            {conflict && (
              <div style={styles.errorBanner}>
                ⚠️ {form.doctorName} já tem uma consulta marcada nesse dia e horário ({conflict.clientName}). Escolha outro horário ou verifique a agenda.
              </div>
            )}

            <label style={styles.label}>
              Forma de pagamento
              <select style={styles.input} value={form.paymentMethod} onChange={(e) => upd("paymentMethod", e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>

            {form.paymentMethod === "Convênio" && (
              <label style={styles.label}>
                Qual convênio?
                <input
                  style={styles.input}
                  value={form.convenioName}
                  onChange={(e) => upd("convenioName", e.target.value)}
                  placeholder="Ex: Unimed, Bradesco Saúde..."
                  required
                />
              </label>
            )}

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

            <div style={styles.row2}>
              <label style={styles.label}>
                Valor da consulta (R$)
                <input
                  type="number" min="0" step="0.01"
                  style={styles.input}
                  value={form.valorTotal}
                  onChange={(e) => upd("valorTotal", e.target.value)}
                  placeholder="0,00"
                  required
                />
              </label>
              {form.paymentStatus === "parcial" && (
                <label style={styles.label}>
                  Valor já pago (R$)
                  <input
                    type="number" min="0" step="0.01"
                    style={styles.input}
                    value={form.valorPago}
                    onChange={(e) => upd("valorPago", e.target.value)}
                    placeholder="0,00"
                    required
                  />
                </label>
              )}
            </div>

            <label style={styles.label}>
              Anotações
              <textarea
                style={{ ...styles.input, minHeight: 70, resize: "vertical" }}
                value={form.notes}
                onChange={(e) => upd("notes", e.target.value)}
                placeholder="Observações sobre a consulta..."
              />
            </label>

            <button type="submit" className="btn tap" style={{ ...styles.submitBtn, ...(conflict ? styles.submitBtnDisabled : {}) }} disabled={!!conflict}>
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

function formatBRL(n) {
  return (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMonthPt(yyyyMm) {
  const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const [y, m] = yyyyMm.split("-");
  return `${meses[parseInt(m, 10) - 1]} de ${y}`;
}

function sumField(list, field) {
  return list.reduce((s, a) => s + (parseFloat(a[field]) || 0), 0);
}

function exportCSV(rows, filename) {
  const header = ["Data", "Horário", "Cliente", "Tipo", "Médico", "Forma de pagamento", "Convênio", "Status", "Valor total", "Valor pago", "Anotações"];
  const csvRows = [
    header,
    ...rows.map((a) => [
      formatDatePt(a.date),
      a.time,
      a.clientName,
      a.appointmentType || "Consulta",
      a.doctorName,
      a.paymentMethod,
      a.convenioName || "",
      STATUS_STYLES[a.paymentStatus]?.label || a.paymentStatus,
      (a.valorTotal || "0").toString().replace(".", ","),
      (a.valorPago || "0").toString().replace(".", ","),
      (a.notes || "").replace(/\n/g, " "),
    ]),
  ];
  const csvContent = csvRows.map((r) => r.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportPDF({ title, subtitle, totals, byMethod, byStatus, byDoctor, filename }) {
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(16);
  doc.text(title, 14, y);
  y += 7;
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text(subtitle, 14, y);
  doc.setTextColor(0);
  y += 12;

  function section(label, lines) {
    if (y > 265) { doc.addPage(); y = 20; }
    doc.setFontSize(13);
    doc.text(label, 14, y);
    y += 7;
    doc.setFontSize(11);
    lines.forEach((line) => {
      if (y > 280) { doc.addPage(); y = 20; }
      doc.text(line, 14, y);
      y += 6.5;
    });
    y += 6;
  }

  section("Resumo", totals);
  section("Por forma de pagamento", byMethod);
  section("Por situação de pagamento", byStatus);
  if (byDoctor && byDoctor.length) section("Por médico", byDoctor);

  doc.save(filename);
}

function FinanceiroScreen({ appointments, doctors, role, selectedDoctorView, onBack }) {
  const [financeMonth, setFinanceMonth] = useState(todayISO().slice(0, 7));
  const [doctorFilterFinance, setDoctorFilterFinance] = useState("todos");

  const effectiveDoctor = role === "chefe" ? selectedDoctorView : doctorFilterFinance;

  const monthAppts = useMemo(
    () =>
      appointments.filter(
        (a) => !a.cancelled && a.date.startsWith(financeMonth) && (effectiveDoctor === "todos" || a.doctorName === effectiveDoctor)
      ),
    [appointments, financeMonth, effectiveDoctor]
  );

  const todayAppts = useMemo(
    () =>
      appointments.filter(
        (a) => !a.cancelled && a.date === todayISO() && (effectiveDoctor === "todos" || a.doctorName === effectiveDoctor)
      ),
    [appointments, effectiveDoctor]
  );

  const totalAgendadoMes = sumField(monthAppts, "valorTotal");
  const totalRecebidoMes = sumField(monthAppts, "valorPago");
  const totalPendenteMes = Math.max(totalAgendadoMes - totalRecebidoMes, 0);
  const totalRecebidoHoje = sumField(todayAppts, "valorPago");

  const byMethod = useMemo(() => {
    const map = new Map();
    for (const a of monthAppts) {
      const key = a.paymentMethod;
      if (!map.has(key)) map.set(key, { count: 0, recebido: 0 });
      const cur = map.get(key);
      cur.count += 1;
      cur.recebido += parseFloat(a.valorPago) || 0;
    }
    return Array.from(map.entries());
  }, [monthAppts]);

  const byStatus = useMemo(() => {
    const map = new Map();
    for (const a of monthAppts) {
      const key = a.paymentStatus;
      if (!map.has(key)) map.set(key, { count: 0, agendado: 0 });
      const cur = map.get(key);
      cur.count += 1;
      cur.agendado += parseFloat(a.valorTotal) || 0;
    }
    return Array.from(map.entries());
  }, [monthAppts]);

  const byDoctor = useMemo(() => {
    if (role !== "secretaria" || effectiveDoctor !== "todos") return [];
    const map = new Map();
    for (const a of monthAppts) {
      const key = a.doctorName || "Sem médico";
      if (!map.has(key)) map.set(key, { count: 0, recebido: 0 });
      const cur = map.get(key);
      cur.count += 1;
      cur.recebido += parseFloat(a.valorPago) || 0;
    }
    return Array.from(map.entries());
  }, [monthAppts, role, effectiveDoctor]);

  const periodLabel = `${formatMonthPt(financeMonth)}${effectiveDoctor !== "todos" ? ` · ${effectiveDoctor}` : ""}`;

  function handleExportCSV() {
    exportCSV(monthAppts, `financeiro-${financeMonth}.csv`);
  }

  function handleExportPDF() {
    exportPDF({
      title: "Relatório financeiro — Agenda da clínica",
      subtitle: periodLabel,
      totals: [
        `Total agendado no mês: R$ ${formatBRL(totalAgendadoMes)}`,
        `Total recebido no mês: R$ ${formatBRL(totalRecebidoMes)}`,
        `Total pendente no mês: R$ ${formatBRL(totalPendenteMes)}`,
        `Recebido hoje: R$ ${formatBRL(totalRecebidoHoje)}`,
      ],
      byMethod: byMethod.map(([k, v]) => `${k}: ${v.count} consulta(s) — R$ ${formatBRL(v.recebido)} recebido`),
      byStatus: byStatus.map(([k, v]) => `${STATUS_STYLES[k]?.label || k}: ${v.count} consulta(s) — R$ ${formatBRL(v.agendado)} agendado`),
      byDoctor: byDoctor.map(([k, v]) => `${k}: ${v.count} consulta(s) — R$ ${formatBRL(v.recebido)} recebido`),
      filename: `financeiro-${financeMonth}.pdf`,
    });
  }

  return (
    <div>
      <button className="btn tap" style={styles.backLink} onClick={onBack}>
        <ArrowLeft size={15} color="#5B5A52" /> Voltar para a agenda
      </button>

      <div style={styles.financeFilters}>
        <label style={styles.label}>
          Mês
          <input
            type="month"
            style={styles.input}
            value={financeMonth}
            onChange={(e) => setFinanceMonth(e.target.value)}
          />
        </label>
        {role === "secretaria" && doctors.length > 0 && (
          <label style={styles.label}>
            Médico
            <select style={styles.input} value={doctorFilterFinance} onChange={(e) => setDoctorFilterFinance(e.target.value)}>
              <option value="todos">Todos os médicos</option>
              {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
        )}
      </div>

      <div style={styles.statGrid}>
        <div style={styles.statCard}>
          <div style={styles.statCardLabel}>Recebido hoje</div>
          <div style={styles.statCardValue}>R$ {formatBRL(totalRecebidoHoje)}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statCardLabel}>Recebido no mês</div>
          <div style={styles.statCardValue}>R$ {formatBRL(totalRecebidoMes)}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statCardLabel}>Agendado no mês</div>
          <div style={styles.statCardValue}>R$ {formatBRL(totalAgendadoMes)}</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statCardLabel}>Falta receber</div>
          <div style={{ ...styles.statCardValue, color: "#A03B2E" }}>R$ {formatBRL(totalPendenteMes)}</div>
        </div>
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Por forma de pagamento</h3>
        {byMethod.length === 0 ? (
          <p style={styles.financeEmpty}>Nenhuma consulta neste período.</p>
        ) : (
          byMethod.map(([k, v]) => (
            <div key={k} style={styles.financeRow}>
              <span>{k} <span style={{ color: "#8A8A82" }}>({v.count})</span></span>
              <strong>R$ {formatBRL(v.recebido)}</strong>
            </div>
          ))
        )}
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Por situação de pagamento</h3>
        {byStatus.map(([k, v]) => (
          <div key={k} style={styles.financeRow}>
            <span>{STATUS_STYLES[k]?.label || k} <span style={{ color: "#8A8A82" }}>({v.count})</span></span>
            <strong>R$ {formatBRL(v.agendado)}</strong>
          </div>
        ))}
      </div>

      {byDoctor.length > 0 && (
        <div style={styles.financeSection}>
          <h3 style={styles.financeSectionTitle}>Por médico</h3>
          {byDoctor.map(([k, v]) => (
            <div key={k} style={styles.financeRow}>
              <span>{k} <span style={{ color: "#8A8A82" }}>({v.count})</span></span>
              <strong>R$ {formatBRL(v.recebido)}</strong>
            </div>
          ))}
        </div>
      )}

      <div style={styles.exportRow}>
        <button className="btn tap" style={styles.exportBtn} onClick={handleExportCSV}>
          <Download size={15} color="#233B34" /> Baixar Excel
        </button>
        <button className="btn tap" style={styles.exportBtn} onClick={handleExportPDF}>
          <FileText size={15} color="#233B34" /> Baixar PDF
        </button>
      </div>
    </div>
  );
}

function PasswordModal({ onClose, onChange }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [oldPwd, setOldPwd] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (pwd.length < 4) return setErr("A nova senha precisa de pelo menos 4 caracteres.");
    if (pwd !== pwd2) return setErr("As senhas novas não coincidem.");
    setLoading(true);
    const ok = await onChange(oldPwd, pwd);
    setLoading(false);
    if (!ok) setErr("Senha atual incorreta.");
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 380 }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={19} color="#2F6F63" /> Trocar senha
            </span>
          </h2>
          <button className="btn tap" style={styles.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={18} color="#5B5A52" />
          </button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          <label style={styles.label}>
            Senha atual
            <input type="password" style={styles.input} value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Nova senha
            <input type="password" style={styles.input} value={pwd} onChange={(e) => setPwd(e.target.value)} required />
          </label>
          <label style={styles.label}>
            Confirmar nova senha
            <input type="password" style={styles.input} value={pwd2} onChange={(e) => setPwd2(e.target.value)} required />
          </label>
          {err && <div style={styles.errorBanner}>{err}</div>}
          <button type="submit" className="btn tap" style={styles.submitBtn} disabled={loading}>
            {loading ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      </div>
    </div>
  );
}

async function lookupEmailByName(name) {
  const { data, error } = await supabase
    .from("secretarias")
    .select("email")
    .ilike("name", name.trim())
    .maybeSingle();
  if (error || !data) return null;
  return data.email;
}

function SecretariaAuthScreen({ view, setView, onSuccess, onCancel }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const foundEmail = await lookupEmailByName(name);
    if (!foundEmail) {
      setLoading(false);
      setError("Nome não encontrado. Confira o nome ou cadastre-se.");
      return;
    }
    const { error: authErr } = await supabase.auth.signInWithPassword({ email: foundEmail, password });
    setLoading(false);
    if (authErr) {
      setError("Senha incorreta.");
      return;
    }
    onSuccess();
  }

  async function handleSignup(e) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !email.trim()) return setError("Preencha nome e e-mail.");
    if (password.length < 4) return setError("A senha precisa de pelo menos 4 caracteres.");
    if (password !== password2) return setError("As senhas não coincidem.");
    setLoading(true);
    const existing = await lookupEmailByName(name);
    if (existing) {
      setLoading(false);
      setError("Esse nome já está cadastrado. Use outro nome ou faça login.");
      return;
    }
    const { data, error: signErr } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { name: name.trim() } },
    });
    if (signErr) {
      setLoading(false);
      setError(signErr.message.includes("registered") ? "Esse e-mail já está cadastrado." : "Não foi possível cadastrar. Tente de novo.");
      return;
    }
    await supabase.from("secretarias").insert({ name: name.trim(), email: email.trim() });
    setLoading(false);
    if (data.session) {
      onSuccess();
    } else {
      setError("Cadastro feito! Confirme seu e-mail e depois faça login.");
      setView("login");
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const foundEmail = await lookupEmailByName(name);
    setLoading(false);
    if (!foundEmail) {
      setError("Nome não encontrado.");
      return;
    }
    await supabase.auth.resetPasswordForEmail(foundEmail, { redirectTo: window.location.origin });
    setView("sent");
  }

  return (
    <div style={styles.roleWrap}>
      <div style={styles.roleCard}>
        <ShieldCheck size={30} color="#2F6F63" />
        <h1 style={styles.roleTitle}>
          {view === "login" && "Entrar como secretária"}
          {view === "signup" && "Criar acesso da secretária"}
          {view === "forgot" && "Esqueci minha senha"}
          {view === "sent" && "E-mail enviado"}
        </h1>

        {view === "sent" ? (
          <>
            <p style={styles.roleSubtitle}>
              Se o nome estiver cadastrado, enviamos um link para o e-mail cadastrado. Abra o e-mail e clique no link para criar uma nova senha.
            </p>
            <button className="btn tap" style={styles.roleBtnPrimary} onClick={() => setView("login")}>Voltar para o login</button>
          </>
        ) : (
          <>
            <p style={styles.roleSubtitle}>
              {view === "login" && "Use seu nome e senha de sempre."}
              {view === "signup" && "Primeiro acesso? Cadastre seu nome, e-mail e uma senha."}
              {view === "forgot" && "Digite seu nome. Enviaremos um link para o e-mail cadastrado."}
            </p>
            <form onSubmit={view === "login" ? handleLogin : view === "signup" ? handleSignup : handleForgot} style={{ ...styles.form, textAlign: "left", padding: 0 }}>
              <label style={styles.label}>
                Nome
                <input style={styles.input} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Seu nome" />
              </label>
              {view === "signup" && (
                <label style={styles.label}>
                  E-mail (só para recuperar a senha)
                  <input type="email" style={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="seu@email.com" />
                </label>
              )}
              {view !== "forgot" && (
                <label style={styles.label}>
                  Senha
                  <input type="password" style={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} required />
                </label>
              )}
              {view === "signup" && (
                <label style={styles.label}>
                  Confirmar senha
                  <input type="password" style={styles.input} value={password2} onChange={(e) => setPassword2(e.target.value)} required />
                </label>
              )}
              {error && <div style={styles.errorBanner}>{error}</div>}
              <button type="submit" className="btn tap" style={styles.submitBtn} disabled={loading}>
                {loading ? "Aguarde..." : view === "login" ? "Entrar" : view === "signup" ? "Criar e entrar" : "Enviar link"}
              </button>
            </form>

            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {view === "login" && (
                <>
                  <button className="btn tap" style={styles.switchBtn} onClick={() => { setError(""); setView("forgot"); }}>Esqueci minha senha</button>
                  <button className="btn tap" style={styles.switchBtn} onClick={() => { setError(""); setView("signup"); }}>Primeiro acesso? Cadastre-se</button>
                </>
              )}
              {view !== "login" && (
                <button className="btn tap" style={styles.switchBtn} onClick={() => { setError(""); setView("login"); }}>Voltar para o login</button>
              )}
            </div>
          </>
        )}

        <button className="btn tap" style={{ ...styles.switchBtn, marginTop: 10 }} onClick={onCancel}>voltar ao início</button>
      </div>
    </div>
  );
}

function ResetPasswordScreen({ onDone }) {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (pwd.length < 4) return setError("Use uma senha com pelo menos 4 caracteres.");
    if (pwd !== pwd2) return setError("As senhas não coincidem.");
    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password: pwd });
    setLoading(false);
    if (updateErr) {
      setError("Não foi possível salvar a nova senha. Tente pedir o link de novo.");
      return;
    }
    setDone(true);
  }

  return (
    <div style={styles.roleWrap}>
      <div style={styles.roleCard}>
        <ShieldCheck size={30} color="#2F6F63" />
        <h1 style={styles.roleTitle}>Criar nova senha</h1>
        {done ? (
          <>
            <p style={styles.roleSubtitle}>Senha atualizada! Agora é só entrar de novo com a nova senha.</p>
            <button className="btn tap" style={styles.roleBtnPrimary} onClick={onDone}>Ir para o login</button>
          </>
        ) : (
          <form onSubmit={submit} style={{ ...styles.form, textAlign: "left", padding: 0 }}>
            <label style={styles.label}>
              Nova senha
              <input type="password" style={styles.input} value={pwd} onChange={(e) => setPwd(e.target.value)} required />
            </label>
            <label style={styles.label}>
              Confirmar nova senha
              <input type="password" style={styles.input} value={pwd2} onChange={(e) => setPwd2(e.target.value)} required />
            </label>
            {error && <div style={styles.errorBanner}>{error}</div>}
            <button type="submit" className="btn tap" style={styles.submitBtn} disabled={loading}>
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
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
  iconBtnActive: { background: "#233B34", borderColor: "#233B34" },
  bellDot: { position: "absolute", top: -4, right: -4, background: "#C24A38", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 99, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", lineHeight: 1 },
  notifDropdown: { position: "absolute", top: 42, right: 0, width: 300, maxHeight: 360, overflowY: "auto", background: "#fff", border: "1px solid #E3E1D9", borderRadius: 12, boxShadow: "0 12px 32px rgba(35,59,52,0.16)", zIndex: 60 },
  notifDropdownHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #ECEAE1", fontSize: 12.5, fontWeight: 700, color: "#233B34" },
  emptyNotif: { padding: "20px 14px", fontSize: 12.5, color: "#8A8A82", textAlign: "center" },
  notifItem: { padding: "10px 12px", borderBottom: "1px solid #F3F2ED" },
  notifActionBtn: { marginTop: 6, background: "#233B34", color: "#fff", border: "none", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 700 },
  errorBanner: { background: "#FBE9E7", color: "#A03B2E", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  pendingBanner: { display: "flex", alignItems: "flex-start", gap: 8, background: "#FBF0DE", color: "#8A5A15", padding: "10px 12px", borderRadius: 10, fontSize: 12.5, marginBottom: 12, lineHeight: 1.4 },
  cardPending: { background: "#FFFDF5", border: "1px solid #EEDFA0" },
  cardCancelled: { background: "#FDF4F2", border: "1px solid #F3C9C2" },
  expandPanel: { display: "flex", flexDirection: "column", gap: 4, background: "#FAF9F5", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12.5, color: "#5B5A52" },
  expandRow: { display: "flex", justifyContent: "space-between", gap: 10 },
  inlineNotice: { display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#8A5A15", marginTop: 8, lineHeight: 1.4 },
  inlineNoticeDanger: { color: "#A03B2E" },
  inlineNoticeInfo: { color: "#2F6F63" },
  inlineNoticeStatic: { marginTop: 0, background: "#FBF0DE", padding: "9px 10px", borderRadius: 9 },
  resolveBtn: { marginTop: 8, background: "#233B34", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 },
  requestActionBtn: { display: "flex", alignItems: "center", gap: 6, marginTop: 9, background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: "#5B5A52" },
  noticeOkBtn: { display: "block", marginTop: 6, background: "#233B34", color: "#fff", border: "none", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 700 },
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
  typeBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#EEF2F0", color: "#2F6F63" },
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
  inputConflict: { borderColor: "#C24A38", background: "#FDF4F2" },
  row2: { display: "flex", gap: 10 },
  statusOptions: { display: "flex", gap: 8, flexWrap: "wrap" },
  statusOption: { display: "flex", alignItems: "center", gap: 5, border: "1.5px solid", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 },
  submitBtn: { background: "#233B34", color: "#fff", border: "none", borderRadius: 11, padding: "14px 16px", fontSize: 15, fontWeight: 700, marginTop: 6 },
  submitBtnDisabled: { background: "#B0AD9F", cursor: "not-allowed" },
  cancelBtn: { flex: 1, background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 600, color: "#5B5A52" },
  deleteBtn: { flex: 1, background: "#C24A38", color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 700 },
  doctorRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FAF9F5", border: "1px solid #ECEAE1", borderRadius: 9, padding: "9px 12px" },
  addDoctorBtn: { width: 44, background: "#2F6F63", border: "none", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" },
  backLink: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 0", fontSize: 13, color: "#5B5A52", marginBottom: 14, fontWeight: 600 },
  financeFilters: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 },
  statCard: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "14px 14px" },
  statCardLabel: { fontSize: 11.5, color: "#8A8A82", fontWeight: 600, marginBottom: 5 },
  statCardValue: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, color: "#233B34" },
  financeSection: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "14px 16px", marginBottom: 12 },
  financeSectionTitle: { fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: "#233B34", margin: "0 0 10px" },
  financeRow: { display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#3A3934", padding: "6px 0", borderBottom: "1px solid #F3F2ED" },
  financeEmpty: { fontSize: 13, color: "#8A8A82", margin: 0 },
  exportRow: { display: "flex", gap: 10, marginTop: 6, marginBottom: 100 },
  exportBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 10, padding: "12px", fontSize: 13.5, fontWeight: 700, color: "#233B34" },
};
