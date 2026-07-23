import React, { useState, useEffect, useMemo, useRef } from "react";
import { Plus, X, Calendar, Search, Check, Clock, CircleDollarSign, StickyNote, ChevronLeft, ChevronRight, ChevronDown, Pencil, Trash2, Stethoscope, ClipboardList, Lock, Users, ShieldCheck, Bell, AlertTriangle, RefreshCw, Ban, PieChart, Download, FileText, ArrowLeft } from "lucide-react";
import jsPDF from "jspdf";
import { supabase } from "./supabaseClient.js";

const STORAGE_KEY = "clinica:consultas";
const DOCTORS_KEY = "clinica:medicos";
const PASSWORD_KEY = "clinica:senha";

const FORMAS_PAGAMENTO = ["Dinheiro", "Pix", "Cartão de débito", "Cartão de crédito", "Convênio", "Outro"];

const TIPOS_CONSULTA = ["Consulta", "Retorno", "Avaliação", "Exame", "Procedimento", "Encaixe/Urgência"];

const INSTALLMENT_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);

function installmentLabel(n) {
  return n <= 1 ? "à vista (1x)" : `${n}x`;
}

// Converte um valor decimal ("5000" ou "5000.00") no total de centavos,
// usado para alimentar o campo de dinheiro mascarado.
function moneyToDigits(value) {
  if (value === "" || value === null || value === undefined) return "";
  const cents = Math.round(parseFloat(value) * 100);
  if (!isFinite(cents) || isNaN(cents)) return "";
  return String(cents);
}

// Converte os dígitos digitados de volta pro formato "5000.00", que é o
// formato que o resto do sistema (somas, relatórios) já sabe interpretar.
function digitsToMoneyValue(digits) {
  if (!digits) return "";
  const n = parseInt(digits, 10);
  return (n / 100).toFixed(2);
}

// Formata os dígitos digitados como "5.000,00" pra exibir no campo,
// no padrão brasileiro — sem qualquer chance de confusão com ponto/vírgula.
function digitsToDisplay(digits) {
  if (!digits) return "";
  const n = parseInt(digits, 10);
  const cents = (n % 100).toString().padStart(2, "0");
  const reais = Math.floor(n / 100).toLocaleString("pt-BR");
  return `${reais},${cents}`;
}

// Campo de dinheiro no estilo "caixa eletrônico": a pessoa digita os números
// em sequência (ex: 5-0-0-0-0-0 pra R$ 5.000,00) e o sistema mesmo posiciona
// o ponto de milhar e a vírgula dos centavos, sem risco de digitar errado.
function MoneyInput({ value, onChange, required, placeholder }) {
  const digits = moneyToDigits(value);
  function handleChange(e) {
    const onlyDigits = e.target.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    onChange(digitsToMoneyValue(onlyDigits));
  }
  return (
    <div style={{ position: "relative" }}>
      <span style={styles.moneyPrefix}>R$</span>
      <input
        type="text"
        inputMode="numeric"
        style={{ ...styles.input, paddingLeft: 34 }}
        value={digitsToDisplay(digits)}
        onChange={handleChange}
        placeholder={placeholder || "0,00"}
        required={required}
      />
    </div>
  );
}

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

const WEEKDAY_LETTERS = ["D", "S", "T", "Q", "Q", "S", "S"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function getWeekDates(dateISO) {
  const d = new Date(dateISO + "T12:00:00");
  const dow = d.getDay();
  const start = new Date(d);
  start.setDate(d.getDate() - dow);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dd = new Date(start);
    dd.setDate(start.getDate() + i);
    out.push(dd.toISOString().slice(0, 10));
  }
  return out;
}

function formatWeekRangePt(weekDates) {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [y1, m1, d1] = weekDates[0].split("-");
  const [y2, m2, d2] = weekDates[6].split("-");
  if (m1 === m2) return `${parseInt(d1, 10)}–${parseInt(d2, 10)} de ${meses[parseInt(m1, 10) - 1]} de ${y1}`;
  return `${parseInt(d1, 10)} de ${meses[parseInt(m1, 10) - 1]} – ${parseInt(d2, 10)} de ${meses[parseInt(m2, 10) - 1]} de ${y2}`;
}

function emptyForm() {
  return {
    id: null,
    date: todayISO(),
    time: "09:00",
    clientName: "",
    doctorName: "",
    appointmentType: TIPOS_CONSULTA[0],
    appointmentTypeDetail: "",
    paymentMethod: FORMAS_PAGAMENTO[0],
    installments: 1,
    paymentStatus: "pendente",
    valorTotal: "",
    valorPago: "",
    convenioName: "",
    splitPayment: false,
    paymentMethod2: FORMAS_PAGAMENTO[0],
    installments2: 1,
    valorPago2: "",
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
  const dateInputRef = useRef(null);
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
  const [pacientesOpen, setPacientesOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== "undefined" ? window.innerWidth >= 880 : false);

  useEffect(() => {
    function handleResize() {
      setIsDesktop(window.innerWidth >= 880);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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
      appointmentTypeDetail: appt.appointmentTypeDetail || "",
      paymentMethod: appt.paymentMethod,
      installments: appt.installments || 1,
      paymentStatus: appt.paymentStatus,
      valorTotal: appt.valorTotal ?? "",
      valorPago: appt.valorPago ?? "",
      convenioName: appt.convenioName ?? "",
      splitPayment: !!appt.paymentMethod2,
      paymentMethod2: appt.paymentMethod2 || FORMAS_PAGAMENTO[0],
      installments2: appt.installments2 || 1,
      valorPago2: appt.valorPago2 ?? "",
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

    const num = (v) => parseFloat(v) || 0;
    // Parte 1 (forma principal) e parte 2 (só existe quando o pagamento foi dividido).
    let valorParte1 = form.valorPago;
    let valorParte2 = form.valorPago2;
    if (form.paymentStatus === "pendente") {
      valorParte1 = "0";
      valorParte2 = "";
    } else if (form.paymentStatus === "pago") {
      // "Pago": se dividido, a parte 2 é sempre o restante do valor total,
      // calculado automaticamente (evita a secretária ter que fazer conta).
      valorParte1 = form.splitPayment ? form.valorPago : form.valorTotal;
      valorParte2 = form.splitPayment ? (num(form.valorTotal) - num(form.valorPago)).toFixed(2) : "";
    } else {
      // "Falta parte": os dois valores são digitados na mão.
      valorParte1 = form.valorPago;
      valorParte2 = form.splitPayment ? form.valorPago2 : "";
    }
    const valorPagoFinal = (num(valorParte1) + num(valorParte2)).toFixed(2);

    const record = {
      ...form,
      valorPago: valorPagoFinal,
      valorPago1: valorParte1,
      paymentMethod2: form.splitPayment ? form.paymentMethod2 : null,
      valorPago2: form.splitPayment ? valorParte2 : null,
      installments: form.paymentMethod === "Cartão de crédito" ? Number(form.installments) || 1 : null,
      installments2:
        form.splitPayment && form.paymentMethod2 === "Cartão de crédito" ? Number(form.installments2) || 1 : null,
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

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const weekGrouped = useMemo(() => {
    let list = [...appointments];
    if (role === "chefe") {
      list = list.filter((a) => a.doctorName === selectedDoctorView && (!a.cancelled || a.doctorNotice));
    } else if (doctorFilter !== "todos") {
      list = list.filter((a) => a.doctorName === doctorFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((a) => a.clientName.toLowerCase().includes(q));
    }
    const map = new Map(weekDates.map((d) => [d, []]));
    for (const a of list) {
      if (map.has(a.date)) map.get(a.date).push(a);
    }
    for (const arr of map.values()) arr.sort((x, y) => x.time.localeCompare(y.time));
    return map;
  }, [appointments, weekDates, doctorFilter, role, selectedDoctorView, search]);

  useEffect(() => {
    if (!isDesktop) return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    let candidates = appointments.filter((a) => a.clientName.toLowerCase().includes(q));
    if (role === "chefe") {
      candidates = candidates.filter((a) => a.doctorName === selectedDoctorView && (!a.cancelled || a.doctorNotice));
    } else if (doctorFilter !== "todos") {
      candidates = candidates.filter((a) => a.doctorName === doctorFilter);
    }
    if (candidates.length === 0) return;
    if (candidates.some((a) => weekDates.includes(a.date))) return;
    candidates.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    const today = todayISO();
    const next = candidates.find((a) => a.date >= today);
    const target = next || candidates[candidates.length - 1];
    setSelectedDate(target.date);
  }, [search, isDesktop, appointments, doctorFilter, role, selectedDoctorView, weekDates]);

  function shiftWeek(n) {
    const d = new Date(selectedDate + "T12:00:00");
    d.setDate(d.getDate() + n * 7);
    setSelectedDate(d.toISOString().slice(0, 10));
  }

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
          <span style={{ color: "#3A3934", fontSize: 14 }}>Carregando...</span>
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
        <div style={{ ...styles.shell, ...(isDesktop ? styles.shellWide : {}) }}>
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
            onOpenPacientes={() => setPacientesOpen(true)}
            pacientesOpen={pacientesOpen}
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
          ) : pacientesOpen ? (
            <PacientesScreen
              appointments={appointments}
              role={role}
              onBack={() => setPacientesOpen(false)}
            />
          ) : (
            <>
          <div style={isDesktop ? styles.controlsWrap : undefined}>
          <div style={styles.toolbar}>
            {isDesktop ? (
              <div style={styles.dateNav}>
                <button className="btn tap" style={styles.iconBtn} onClick={() => shiftWeek(-1)} aria-label="Semana anterior">
                  <ChevronLeft size={18} color="#2F6F63" />
                </button>
                <button className="btn tap" style={styles.dateChip} onClick={() => setSelectedDate(todayISO())}>
                  <Calendar size={15} color="#2F6F63" />
                  <span>{formatWeekRangePt(weekDates)}</span>
                </button>
                <button className="btn tap" style={styles.iconBtn} onClick={() => shiftWeek(1)} aria-label="Próxima semana">
                  <ChevronRight size={18} color="#2F6F63" />
                </button>
              </div>
            ) : (
              <div style={styles.dateNav}>
                <button className="btn tap" style={styles.iconBtn} onClick={() => shiftDate(-1)} aria-label="Dia anterior">
                  <ChevronLeft size={18} color="#2F6F63" />
                </button>
                <div style={{ position: "relative" }}>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="btn tap"
                    style={{ ...styles.dateChip, ...(showAllDates ? styles.dateChipInactive : {}), pointerEvents: "none" }}
                  >
                    <Calendar size={15} color="#2F6F63" />
                    <span style={{ textTransform: "capitalize" }}>
                      {showAllDates ? "escolher dia" : `${formatDatePt(selectedDate)} · ${weekdayPt(selectedDate)}`}
                    </span>
                  </button>
                  <input
                    ref={dateInputRef}
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      if (e.target.value) {
                        setSelectedDate(e.target.value);
                        setShowAllDates(false);
                      }
                    }}
                    aria-label="Escolher data"
                    style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  />
                </div>
                <button className="btn tap" style={styles.iconBtn} onClick={() => shiftDate(1)} aria-label="Próximo dia">
                  <ChevronRight size={18} color="#2F6F63" />
                </button>
              </div>
            )}
            {!isDesktop && (
              <button
                className="btn tap"
                style={{ ...styles.pill, ...(showAllDates ? styles.pillActive : {}) }}
                onClick={() => setShowAllDates((v) => !v)}
              >
                {showAllDates ? "Ver só o dia" : "Ver todas as datas"}
              </button>
            )}
          </div>

          {role === "secretaria" && doctors.length > 0 && (
            <div style={styles.searchRow}>
              <Stethoscope size={15} color="#3A3934" />
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
            <Search size={16} color="#3A3934" />
            <input
              style={styles.searchInput}
              placeholder="Buscar cliente pelo nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          </div>

          {isDesktop ? (
            <WeekGridView
              weekDates={weekDates}
              weekGrouped={weekGrouped}
              onEditAppt={openEditForm}
              onNewForDate={(d) => (doctors.length === 0 ? setDoctorManagerOpen(true) : openNewForm(d))}
              isSecretaria={isSecretaria}
            />
          ) : (
          <div style={styles.list}>
            {grouped.length === 0 ? (
              <div style={styles.emptyState}>
                <ClipboardList size={28} color="#B9B6A9" />
                <p style={{ margin: "10px 0 4px", fontWeight: 600, color: "#54524A" }}>Nenhuma consulta aqui ainda</p>
                {isSecretaria && (
                  <p style={{ margin: 0, fontSize: 13, color: "#3A3934" }}>
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
          )}

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
          onDelete={form.id ? () => { setFormOpen(false); setConfirmDelete(form.id); } : null}
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
        <h1 style={styles.roleTitle}>Clínica Cemo</h1>
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
  onOpenPacientes,
  pacientesOpen,
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
      <div style={styles.headerActions}>
        {saving && <span style={styles.savingTag}>salvando...</span>}

        <button
          className="btn tap"
          style={{ ...styles.financeBtn, ...(financeiroOpen ? styles.iconBtnActive : {}) }}
          onClick={onOpenFinanceiro}
          aria-label="Financeiro"
        >
          <PieChart size={15} color={financeiroOpen ? "#fff" : "#3A3934"} />
          <span style={{ color: financeiroOpen ? "#fff" : "#3A3934" }}>Financeiro</span>
        </button>

        <button
          className="btn tap"
          style={{ ...styles.financeBtn, ...(pacientesOpen ? styles.iconBtnActive : {}) }}
          onClick={onOpenPacientes}
          aria-label="Pacientes"
        >
          <ClipboardList size={15} color={pacientesOpen ? "#fff" : "#3A3934"} />
          <span style={{ color: pacientesOpen ? "#fff" : "#3A3934" }}>Pacientes</span>
        </button>

        {role === "secretaria" && (
          <button className="btn tap" style={styles.financeBtn} onClick={onOpenDoctors} aria-label="Médicos da clínica">
            <Users size={15} color="#3A3934" />
            <span>Médicos</span>
          </button>
        )}

        <div style={{ position: "relative" }}>
          <button className="btn tap" style={styles.financeBtn} onClick={() => setNotifOpen(true)} aria-label="Notificações">
            <Bell size={15} color="#3A3934" />
            <span>Notificações</span>
            {notifItems.length > 0 && <span style={styles.bellDot}>{notifItems.length}</span>}
          </button>
          {notifOpen && (
            <div style={styles.modalOverlay} onClick={() => setNotifOpen(false)}>
              <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.modalHeader}>
                  <h2 style={styles.modalTitle}>Notificações</h2>
                  <button className="btn tap" style={styles.iconBtn} onClick={() => setNotifOpen(false)} aria-label="Fechar">
                    <X size={18} color="#3A3934" />
                  </button>
                </div>
                <div style={{ padding: "6px 18px 22px" }}>
                  {notifItems.length === 0 ? (
                    <div style={styles.emptyNotif}>Nenhuma notificação por aqui.</div>
                  ) : (
                    notifItems.map(({ kind, appt }) => (
                      <div key={appt.id} style={styles.notifItem}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#233B34" }}>{appt.clientName}</div>
                        <div style={{ fontSize: 11.5, color: "#3A3934", marginBottom: 4 }}>
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
              </div>
            </div>
          )}
        </div>

        {role === "secretaria" && (
          <button className="btn tap" style={styles.financeBtn} onClick={onOpenPassword} aria-label="Trocar senha">
            <Lock size={15} color="#3A3934" />
            <span>Senha</span>
          </button>
        )}
        <button className="btn tap" style={styles.switchBtn} onClick={onSwitchRole}>Sair</button>
      </div>

      <div style={styles.headerTitleBlock}>
        <div style={styles.headerEyebrow}>
          {role === "secretaria" ? `Painel da secretária${secretaryName ? ` · ${secretaryName}` : ""}` : "Agenda do médico"}
        </div>
        <h1 style={styles.headerTitle}>
          {role === "chefe" ? `Agenda do Doutor(a) ${selectedDoctorView}` : "Agenda da Clínica Cemo"}
        </h1>
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
            <ClipboardList size={11} color="#2F6F63" />
            {appt.appointmentType || "Consulta"}{appt.appointmentTypeDetail ? ` · ${appt.appointmentTypeDetail}` : ""}
          </span>
          <span style={{ ...styles.statusBadge, background: st.bg, color: st.text }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: st.dot, display: "inline-block" }} />
            {st.label}
          </span>
          {appt.doctorName && role !== "chefe" && (
            <span style={styles.cardMetaItem}>
              <Stethoscope size={13} color="#3A3934" /> {appt.doctorName}
            </span>
          )}
          <span style={styles.cardMetaItem}>
            <CircleDollarSign size={13} color="#3A3934" />
            {appt.paymentMethod}
            {appt.installments > 1 ? ` (${appt.installments}x)` : ""}
            {appt.paymentMethod2 ? ` + ${appt.paymentMethod2}${appt.installments2 > 1 ? ` (${appt.installments2}x)` : ""}` : ""}
          </span>
        </div>

        {expanded && (
          <div style={styles.expandPanel}>
            <div style={styles.expandRow}><span>Valor total</span><strong>{appt.valorTotal ? `R$ ${formatBRL(parseFloat(appt.valorTotal))}` : "—"}</strong></div>
            <div style={styles.expandRow}><span>Valor já pago</span><strong>{appt.valorPago ? `R$ ${formatBRL(parseFloat(appt.valorPago))}` : "—"}</strong></div>
            {appt.paymentMethod2 && (
              <>
                <div style={styles.expandRow}>
                  <span>Via {appt.paymentMethod}{appt.installments > 1 ? ` (${appt.installments}x)` : ""}</span>
                  <strong>R$ {formatBRL(parseFloat(appt.valorPago1 ?? appt.valorPago))}</strong>
                </div>
                <div style={styles.expandRow}>
                  <span>Via {appt.paymentMethod2}{appt.installments2 > 1 ? ` (${appt.installments2}x)` : ""}</span>
                  <strong>R$ {formatBRL(parseFloat(appt.valorPago2))}</strong>
                </div>
              </>
            )}
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
            <RefreshCw size={13} color="#3A3934" /> Solicitar cancelamento ou remarcação
          </button>
        )}
      </div>
      {editable && (
        <div style={styles.cardActions}>
          <button className="btn tap" style={styles.smallIconBtn} onClick={onEdit} aria-label="Editar">
            <Pencil size={15} color="#3A3934" />
          </button>
          <button className="btn tap" style={styles.smallIconBtn} onClick={onDelete} aria-label="Excluir">
            <Trash2 size={15} color="#B04A3B" />
          </button>
        </div>
      )}
    </div>
  );
}

function WeekGridView({ weekDates, weekGrouped, onEditAppt, onNewForDate, isSecretaria }) {
  const today = todayISO();
  return (
    <div style={styles.weekGrid}>
      {weekDates.map((date, i) => {
        const items = weekGrouped.get(date) || [];
        const isToday = date === today;
        const [, m, d] = date.split("-");
        return (
          <div key={date} style={styles.weekCol}>
            <div style={{ ...styles.weekColHeader, ...(isToday ? styles.weekColHeaderToday : {}) }}>
              <div style={styles.weekColLetter}>{WEEKDAY_LETTERS[i]}</div>
              <div style={styles.weekColNum}>{parseInt(d, 10)}</div>
              <div style={styles.weekColMonth}>{WEEKDAY_SHORT[i]}</div>
              {isToday && <div style={styles.weekTodayDot} />}
            </div>
            <div style={styles.weekColBody}>
              {items.length === 0 ? (
                <div style={styles.weekColEmpty}>—</div>
              ) : (
                items.map((a) => {
                  const st = STATUS_STYLES[a.paymentStatus] || STATUS_STYLES.pendente;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className="btn tap"
                      style={{ ...styles.weekChip, borderLeft: `3px solid ${st.dot}` }}
                      onClick={() => onEditAppt(a)}
                    >
                      <div style={styles.weekChipTime}>{a.time}</div>
                      <div style={styles.weekChipName}>{a.clientName}</div>
                      {a.doctorName && <div style={styles.weekChipDoctor}>{a.doctorName}</div>}
                    </button>
                  );
                })
              )}
              {isSecretaria && (
                <button type="button" className="btn tap" style={styles.weekAddBtn} onClick={() => onNewForDate(date)}>
                  <Plus size={13} color="#2F6F63" /> Nova
                </button>
              )}
            </div>
          </div>
        );
      })}
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
            <X size={18} color="#3A3934" />
          </button>
        </div>
        <form onSubmit={submit} style={styles.form}>
          <p style={{ fontSize: 13, color: "#3A3934", margin: "-4px 0 0" }}>
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
                  color: type === "cancelamento" ? "#A03B2E" : "#3A3934",
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
                  color: type === "remarcacao" ? "#8A5A15" : "#3A3934",
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
            <X size={18} color="#3A3934" />
          </button>
        </div>
        <div style={styles.form}>
          <p style={{ fontSize: 13.5, color: "#3A3934", margin: 0 }}>
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

function FormModal({ form, setForm, doctors, appointments, onClose, onSubmit, isEditing, onOpenDoctorManager, onDelete }) {
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
            <X size={18} color="#3A3934" />
          </button>
        </div>

        {doctors.length === 0 ? (
          <div style={{ padding: "6px 18px 24px" }}>
            <p style={{ fontSize: 13.5, color: "#3A3934", marginBottom: 12 }}>
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
              Detalhe (opcional)
              <input
                style={styles.input}
                value={form.appointmentTypeDetail}
                onChange={(e) => upd("appointmentTypeDetail", e.target.value)}
                placeholder="Ex: Quimioterapia, Raio-X do joelho, Sutura..."
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
                      color: form.paymentStatus === key ? s.text : "#3A3934",
                      borderColor: form.paymentStatus === key ? s.dot : "#E3E1D9",
                    }}
                  >
                    {form.paymentStatus === key && <Check size={13} />}
                    {s.label}
                  </button>
                ))}
              </div>
            </label>

            <label style={styles.label}>
              Valor da consulta
              <MoneyInput value={form.valorTotal} onChange={(v) => upd("valorTotal", v)} required />
            </label>

            <label style={styles.label}>
              Forma de pagamento{form.paymentStatus !== "pendente" && form.splitPayment ? " (1ª forma)" : ""}
              <select style={styles.input} value={form.paymentMethod} onChange={(e) => upd("paymentMethod", e.target.value)}>
                {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>

            {form.paymentMethod === "Cartão de crédito" && (
              <label style={styles.label}>
                Em quantas vezes?
                <select style={styles.input} value={form.installments} onChange={(e) => upd("installments", Number(e.target.value))}>
                  {INSTALLMENT_OPTIONS.map((n) => <option key={n} value={n}>{installmentLabel(n)}</option>)}
                </select>
              </label>
            )}

            {(form.paymentMethod === "Convênio" || (form.splitPayment && form.paymentMethod2 === "Convênio")) && (
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

            {form.paymentStatus !== "pendente" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 600, color: "#3A3934" }}>
                <input
                  type="checkbox"
                  checked={form.splitPayment}
                  onChange={(e) => upd("splitPayment", e.target.checked)}
                />
                Pagamento dividido em 2 formas (ex: metade Pix, metade dinheiro)
              </label>
            )}

            {form.paymentStatus === "pago" && form.splitPayment && (
              <div style={styles.row2}>
                <label style={styles.label}>
                  Valor recebido (1ª forma)
                  <MoneyInput value={form.valorPago} onChange={(v) => upd("valorPago", v)} required />
                </label>
                <label style={styles.label}>
                  Valor na 2ª forma (automático)
                  <div style={{ ...styles.input, background: "#F7F6F1", color: "#3A3934" }}>
                    R$ {formatBRL(Math.max((parseFloat(form.valorTotal) || 0) - (parseFloat(form.valorPago) || 0), 0))}
                  </div>
                </label>
              </div>
            )}

            {form.paymentStatus === "parcial" && (
              <div style={styles.row2}>
                <label style={styles.label}>
                  Valor já pago{form.splitPayment ? " (1ª forma)" : ""}
                  <MoneyInput value={form.valorPago} onChange={(v) => upd("valorPago", v)} required />
                </label>
                {form.splitPayment && (
                  <label style={styles.label}>
                    Valor já pago (2ª forma)
                    <MoneyInput value={form.valorPago2} onChange={(v) => upd("valorPago2", v)} required />
                  </label>
                )}
              </div>
            )}

            {form.paymentStatus !== "pendente" && form.splitPayment && (
              <label style={styles.label}>
                Forma de pagamento (2ª forma)
                <select style={styles.input} value={form.paymentMethod2} onChange={(e) => upd("paymentMethod2", e.target.value)}>
                  {FORMAS_PAGAMENTO.map((f) => <option key={f} value={f}>{f}</option>)}
                </select>
              </label>
            )}

            {form.paymentStatus !== "pendente" && form.splitPayment && form.paymentMethod2 === "Cartão de crédito" && (
              <label style={styles.label}>
                Em quantas vezes (2ª forma)?
                <select style={styles.input} value={form.installments2} onChange={(e) => upd("installments2", Number(e.target.value))}>
                  {INSTALLMENT_OPTIONS.map((n) => <option key={n} value={n}>{installmentLabel(n)}</option>)}
                </select>
              </label>
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

            <button type="submit" className="btn tap" style={{ ...styles.submitBtn, ...(conflict ? styles.submitBtnDisabled : {}) }} disabled={!!conflict}>
              {isEditing ? "Salvar alterações" : "Marcar consulta"}
            </button>
            {isEditing && onDelete && (
              <button type="button" className="btn tap" style={styles.deleteLinkBtn} onClick={onDelete}>
                <Trash2 size={14} color="#A03B2E" /> Excluir esta consulta
              </button>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({ onCancel, onConfirm, message = "Excluir esta consulta da agenda? Essa ação não pode ser desfeita." }) {
  return (
    <div style={styles.modalOverlay} onClick={onCancel}>
      <div style={{ ...styles.modal, maxWidth: 320 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: "22px 20px" }}>
          <p style={{ margin: "0 0 18px", fontSize: 15, color: "#3A3934" }}>{message}</p>
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
            <X size={18} color="#3A3934" />
          </button>
        </div>
        <div style={{ padding: "6px 18px 22px" }}>
          {doctors.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#3A3934", marginBottom: 14 }}>Nenhum médico cadastrado ainda.</p>
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

function formatBRLShort(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".", ",")}k`;
  return formatBRL(n);
}

function formatMonthShortPt(yyyyMm) {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const [y, m] = yyyyMm.split("-");
  return `${meses[parseInt(m, 10) - 1]}/${y.slice(2)}`;
}

function lastNMonths(yyyyMm, n) {
  const [y, m] = yyyyMm.split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

const CHART_PALETTE = ["#16A34A", "#0EA5E9", "#F59E0B", "#8B5CF6", "#EF4444", "#EC4899", "#64748B"];
const STATUS_CHART_COLORS = { pago: "#22C55E", parcial: "#F59E0B", pendente: "#EF4444" };

// Gráfico de rosca simples, feito em SVG puro — sem precisar instalar
// nenhuma biblioteca de gráficos, pra manter o app leve e gratuito.
function DonutChart({ data, size = 140, strokeWidth = 24 }) {
  const [activeIdx, setActiveIdx] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  let acc = 0;
  const active = activeIdx !== null ? data[activeIdx] : null;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0 }}
      onMouseLeave={() => setActiveIdx(null)}
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        {total <= 0 ? (
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#ECEAE1" strokeWidth={strokeWidth} />
        ) : (
          data.map((d, i) => {
            const frac = d.value / total;
            const dash = Math.max(frac * circumference, 0);
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={d.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-acc}
                opacity={activeIdx === null || activeIdx === i ? 1 : 0.3}
                style={{ cursor: "pointer", transition: "opacity .15s ease" }}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => setActiveIdx((cur) => (cur === i ? null : i))}
              />
            );
            acc += dash;
            return el;
          })
        )}
      </g>
      <text x="50%" y="47%" textAnchor="middle" fontSize="11" fontWeight="700" fill="#233B34">
        R$ {formatBRLShort(active ? active.value : total)}
      </text>
      <text x="50%" y="61%" textAnchor="middle" fontSize="9" fill="#3A3934">
        {active ? active.label : "total"}
      </text>
    </svg>
  );
}

function ChartLegend({ data }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minWidth: 0 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
          <span style={{ width: 9, height: 9, borderRadius: 99, background: d.color, flexShrink: 0 }} />
          <span style={{ color: "#3A3934", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label}
          </span>
          <strong style={{ color: "#233B34" }}>
            {total > 0 ? `${Math.round((d.value / total) * 100)}%` : "0%"}
          </strong>
        </div>
      ))}
    </div>
  );
}

// Gráfico de barras simples pra mostrar a evolução do recebido mês a mês.
function TrendBarChart({ data, height = 130, valueKey = "recebido", formatValue = formatBRLShort, barColor = "#2F6F63" }) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height, padding: "0 2px" }}>
      {data.map((d) => (
        <div key={d.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#3A3934", fontWeight: 700 }}>
            {d[valueKey] > 0 ? formatValue(d[valueKey]) : ""}
          </div>
          <div
            style={{
              width: "100%",
              maxWidth: 30,
              height: Math.max((d[valueKey] / max) * (height - 42), 3),
              background: barColor,
              borderRadius: "6px 6px 0 0",
            }}
          />
          <div style={{ fontSize: 10, color: "#3A3934" }}>{formatMonthShortPt(d.month)}</div>
        </div>
      ))}
    </div>
  );
}

function exportCSV(rows, filename) {
  const header = [
    "Data", "Horário", "Cliente", "Tipo", "Detalhe", "Médico",
    "Forma de pagamento (1)", "Parcelas (1)", "Valor recebido (1)",
    "Forma de pagamento (2)", "Parcelas (2)", "Valor recebido (2)",
    "Convênio", "Status", "Valor total", "Valor pago", "Anotações",
  ];
  const csvRows = [
    header,
    ...rows.map((a) => [
      formatDatePt(a.date),
      a.time,
      a.clientName,
      a.appointmentType || "Consulta",
      a.appointmentTypeDetail || "",
      a.doctorName,
      a.paymentMethod,
      a.installments > 1 ? `${a.installments}x` : "",
      (a.paymentMethod2 ? (a.valorPago1 ?? a.valorPago) : a.valorPago || "0").toString().replace(".", ","),
      a.paymentMethod2 || "",
      a.installments2 > 1 ? `${a.installments2}x` : "",
      a.paymentMethod2 ? (a.valorPago2 || "0").toString().replace(".", ",") : "",
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
  const totalConsultasMes = monthAppts.length;

  const previousMonthKey = useMemo(() => lastNMonths(financeMonth, 2)[0], [financeMonth]);
  const totalConsultasMesAnterior = useMemo(
    () =>
      appointments.filter(
        (a) => !a.cancelled && a.date.startsWith(previousMonthKey) && (effectiveDoctor === "todos" || a.doctorName === effectiveDoctor)
      ).length,
    [appointments, previousMonthKey, effectiveDoctor]
  );
  const diffConsultas = totalConsultasMes - totalConsultasMesAnterior;

  const byMethod = useMemo(() => {
    // Quando uma consulta teve pagamento dividido em 2 formas, cada parte
    // entra separadamente na forma de pagamento certa.
    const map = new Map();
    function add(key, count, valor) {
      if (!key) return;
      if (!map.has(key)) map.set(key, { count: 0, recebido: 0 });
      const cur = map.get(key);
      cur.count += count;
      cur.recebido += valor;
    }
    for (const a of monthAppts) {
      if (a.paymentMethod2) {
        add(a.paymentMethod, 1, parseFloat(a.valorPago1 ?? a.valorPago) || 0);
        add(a.paymentMethod2, 1, parseFloat(a.valorPago2) || 0);
      } else {
        add(a.paymentMethod, 1, parseFloat(a.valorPago) || 0);
      }
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

  const monthlyTrend = useMemo(() => {
    const months = lastNMonths(financeMonth, 6);
    return months.map((mm) => {
      const appsDoMes = appointments.filter(
        (a) => !a.cancelled && a.date.startsWith(mm) && (effectiveDoctor === "todos" || a.doctorName === effectiveDoctor)
      );
      return {
        month: mm,
        recebido: sumField(appsDoMes, "valorPago"),
        quantidade: appsDoMes.length,
      };
    });
  }, [appointments, financeMonth, effectiveDoctor]);

  const methodChartData = useMemo(
    () => byMethod.map(([k, v], i) => ({ label: k, value: v.recebido, color: CHART_PALETTE[i % CHART_PALETTE.length] })),
    [byMethod]
  );

  const statusChartData = useMemo(
    () =>
      byStatus.map(([k, v]) => ({
        label: STATUS_STYLES[k]?.label || k,
        value: v.agendado,
        color: STATUS_CHART_COLORS[k] || "#94A3B8",
      })),
    [byStatus]
  );

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
    <div style={styles.financeWrap}>
      <button className="btn tap" style={styles.backLink} onClick={onBack}>
        <ArrowLeft size={15} color="#3A3934" /> Voltar para a agenda
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
        <div style={styles.statCard}>
          <div style={styles.statCardLabel}>Consultas no mês</div>
          <div style={styles.statCardValue}>{totalConsultasMes}</div>
          {totalConsultasMesAnterior > 0 && (
            <div style={{ fontSize: 11.5, fontWeight: 600, marginTop: 2, color: diffConsultas >= 0 ? "#2F6F63" : "#A03B2E" }}>
              {diffConsultas === 0 ? "Igual ao mês anterior" : diffConsultas > 0 ? `▲ ${diffConsultas} a mais que o mês anterior` : `▼ ${Math.abs(diffConsultas)} a menos que o mês anterior`}
            </div>
          )}
        </div>
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Recebido nos últimos 6 meses</h3>
        <TrendBarChart data={monthlyTrend} valueKey="recebido" formatValue={formatBRLShort} barColor="#2F6F63" />
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Consultas nos últimos 6 meses</h3>
        <TrendBarChart data={monthlyTrend} valueKey="quantidade" formatValue={(n) => String(n)} barColor="#7A9B8E" />
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Por forma de pagamento</h3>
        {byMethod.length === 0 ? (
          <p style={styles.financeEmpty}>Nenhuma consulta neste período.</p>
        ) : (
          <>
            <div style={styles.chartRow}>
              <DonutChart data={methodChartData} />
              <ChartLegend data={methodChartData} />
            </div>
            {byMethod.map(([k, v]) => (
              <div key={k} style={styles.financeRow}>
                <span>{k} <span style={{ color: "#3A3934" }}>({v.count})</span></span>
                <strong>R$ {formatBRL(v.recebido)}</strong>
              </div>
            ))}
          </>
        )}
      </div>

      <div style={styles.financeSection}>
        <h3 style={styles.financeSectionTitle}>Por situação de pagamento</h3>
        <div style={styles.chartRow}>
          <DonutChart data={statusChartData} />
          <ChartLegend data={statusChartData} />
        </div>
        {byStatus.map(([k, v]) => (
          <div key={k} style={styles.financeRow}>
            <span>{STATUS_STYLES[k]?.label || k} <span style={{ color: "#3A3934" }}>({v.count})</span></span>
            <strong>R$ {formatBRL(v.agendado)}</strong>
          </div>
        ))}
      </div>

      {byDoctor.length > 0 && (
        <div style={styles.financeSection}>
          <h3 style={styles.financeSectionTitle}>Por médico</h3>
          {byDoctor.map(([k, v]) => (
            <div key={k} style={styles.financeRow}>
              <span>{k} <span style={{ color: "#3A3934" }}>({v.count})</span></span>
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

function normalizePatientKey(name) {
  return (name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const PRONTUARIO_TYPES = [
  { value: "aplicacao", label: "Aplicação" },
  { value: "dose", label: "Dose de medicação" },
  { value: "laser", label: "Laser" },
  { value: "capacete", label: "Capacete" },
  { value: "outro", label: "Outros" },
];

function exportProntuarioPDF({ patientName, entries, totalConsultas }) {
  const doc = new jsPDF();
  let y = 20;
  doc.setFontSize(16);
  doc.text(`Prontuário — ${patientName}`, 14, y);
  y += 7;
  doc.setFontSize(11);
  doc.setTextColor(120);
  doc.text(`Emitido em ${formatDatePt(todayISO())} · ${totalConsultas} consulta(s) na agenda`, 14, y);
  doc.setTextColor(0);
  y += 12;

  doc.setFontSize(13);
  doc.text("Histórico de acompanhamento", 14, y);
  y += 8;
  doc.setFontSize(11);

  if (entries.length === 0) {
    doc.text("Nenhum registro ainda.", 14, y);
  } else {
    entries.forEach((e) => {
      if (y > 275) { doc.addPage(); y = 20; }
      const typeLabel = PRONTUARIO_TYPES.find((t) => t.value === e.type)?.label || e.type;
      doc.setFont(undefined, "bold");
      doc.text(`${formatDatePt(e.date)} — ${typeLabel}`, 14, y);
      doc.setFont(undefined, "normal");
      y += 6;
      if (e.text) {
        const lines = doc.splitTextToSize(e.text, 180);
        lines.forEach((line) => {
          if (y > 280) { doc.addPage(); y = 20; }
          doc.text(line, 16, y);
          y += 5.5;
        });
      }
      y += 4;
    });
  }

  doc.save(`prontuario-${normalizePatientKey(patientName).replace(/\s+/g, "-")}.pdf`);
}

function PacientesScreen({ appointments, role, onBack }) {
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);

  const patients = useMemo(() => {
    const map = new Map();
    for (const a of appointments) {
      const key = normalizePatientKey(a.clientName);
      if (!key) continue;
      if (!map.has(key)) map.set(key, { key, name: a.clientName, count: 0, lastDate: a.date });
      const p = map.get(key);
      p.count += 1;
      if (a.date > p.lastDate) { p.lastDate = a.date; p.name = a.clientName; }
    }
    return Array.from(map.values()).sort((x, y) => y.lastDate.localeCompare(x.lastDate));
  }, [appointments]);

  const filteredPatients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return patients;
    return patients.filter((p) => p.name.toLowerCase().includes(q));
  }, [patients, search]);

  const selectedPatient = patients.find((p) => p.key === selectedKey) || null;

  if (selectedPatient) {
    return (
      <PatientProntuario
        patient={selectedPatient}
        role={role}
        onBack={() => setSelectedKey(null)}
      />
    );
  }

  return (
    <div style={styles.financeWrap}>
      <button className="btn tap" style={styles.backLink} onClick={onBack}>
        <ArrowLeft size={16} color="#3A3934" /> Voltar para a agenda
      </button>
      <h2 style={styles.financeTitle}>Pacientes</h2>

      <div style={styles.searchRow}>
        <Search size={15} color="#8A8A82" />
        <input
          style={styles.searchInput}
          placeholder="Buscar paciente pelo nome..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredPatients.length === 0 ? (
        <div style={styles.emptyState}>
          <ClipboardList size={28} color="#B9B6A9" />
          <p style={{ margin: "10px 0 0", fontWeight: 600, color: "#54524A" }}>Nenhum paciente encontrado</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {filteredPatients.map((p) => (
            <button
              key={p.key}
              type="button"
              className="btn tap"
              style={styles.patientRow}
              onClick={() => setSelectedKey(p.key)}
            >
              <div>
                <div style={styles.patientRowName}>{p.name}</div>
                <div style={styles.patientRowMeta}>{p.count} consulta(s) · última em {formatDatePt(p.lastDate)}</div>
              </div>
              <ChevronRight size={18} color="#8A8A82" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PatientProntuario({ patient, role, onBack }) {
  const isSecretaria = role === "secretaria";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [record, setRecord] = useState(null);
  const [entryDate, setEntryDate] = useState(todayISO());
  const [entryType, setEntryType] = useState("aplicacao");
  const [entryText, setEntryText] = useState("");
  const [confirmDeleteEntry, setConfirmDeleteEntry] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    supabase
      .from("prontuarios")
      .select("*")
      .eq("patient_key", patient.key)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError("Não foi possível carregar o prontuário agora.");
        setRecord(data || null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [patient.key]);

  const entries = useMemo(
    () => (record?.entries || []).slice().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || ""))),
    [record]
  );

  const countsByType = useMemo(() => {
    const counts = {};
    for (const t of PRONTUARIO_TYPES) counts[t.value] = 0;
    for (const e of entries) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
  }, [entries]);

  async function handleDeleteEntry(entryId) {
    setSaving(true);
    setError(null);
    const nextEntries = (record?.entries || []).filter((e) => e.id !== entryId);
    const { data, error: err } = await supabase
      .from("prontuarios")
      .upsert(
        {
          patient_key: patient.key,
          patient_name: patient.name,
          entries: nextEntries,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_key" }
      )
      .select()
      .maybeSingle();
    setSaving(false);
    setConfirmDeleteEntry(null);
    if (err) {
      setError("Não foi possível excluir. Verifique se você está logada e tente de novo.");
      return;
    }
    setRecord(data);
  }

  async function handleAddEntry(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      date: entryDate,
      type: entryType,
      text: entryText.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextEntries = [...(record?.entries || []), newEntry];
    const { data, error: err } = await supabase
      .from("prontuarios")
      .upsert(
        {
          patient_key: patient.key,
          patient_name: patient.name,
          entries: nextEntries,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "patient_key" }
      )
      .select()
      .maybeSingle();
    setSaving(false);
    if (err) {
      setError("Não foi possível salvar. Verifique se você está logada e tente de novo.");
      return;
    }
    setRecord(data);
    setEntryText("");
    setEntryDate(todayISO());
  }

  return (
    <div style={styles.financeWrap}>
      <button className="btn tap" style={styles.backLink} onClick={onBack}>
        <ArrowLeft size={16} color="#3A3934" /> Voltar para pacientes
      </button>
      <h2 style={styles.financeTitle}>{patient.name}</h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#3A3934" }}>
        {patient.count} consulta(s) registradas na agenda · última em {formatDatePt(patient.lastDate)}
      </p>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {loading ? (
        <p style={{ color: "#3A3934" }}>Carregando prontuário...</p>
      ) : (
        <>
          <div style={styles.prontuarioCounters}>
            {PRONTUARIO_TYPES.map((t) => (
              <span key={t.value}><strong>{countsByType[t.value] || 0}</strong> {t.label.toLowerCase()}</span>
            ))}
          </div>

          {isSecretaria && (
            <form onSubmit={handleAddEntry} style={styles.prontuarioForm}>
              <div style={{ display: "flex", gap: 10 }}>
                <label style={{ flex: 1 }}>
                  <span style={styles.label}>Data</span>
                  <input type="date" style={styles.input} value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />
                </label>
                <label style={{ flex: 1 }}>
                  <span style={styles.label}>Tipo</span>
                  <select style={styles.input} value={entryType} onChange={(e) => setEntryType(e.target.value)}>
                    {PRONTUARIO_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <span style={styles.label}>Anotação (opcional)</span>
                <textarea
                  style={{ ...styles.input, minHeight: 130, width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "inherit" }}
                  value={entryText}
                  onChange={(e) => setEntryText(e.target.value)}
                  placeholder="Ex: aplicada dose semanal, sem intercorrências..."
                />
              </label>
              <button type="submit" className="btn tap" style={styles.submitBtn} disabled={saving}>
                {saving ? "Salvando..." : "+ Adicionar ao prontuário"}
              </button>
            </form>
          )}

          <div style={styles.exportRow}>
            <button
              className="btn tap"
              style={styles.exportBtn}
              onClick={() => exportProntuarioPDF({ patientName: patient.name, entries, totalConsultas: patient.count })}
            >
              <FileText size={15} color="#233B34" /> Exportar PDF
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            {entries.length === 0 ? (
              <div style={styles.emptyState}>
                <ClipboardList size={28} color="#B9B6A9" />
                <p style={{ margin: "10px 0 0", fontWeight: 600, color: "#54524A" }}>Nenhum registro ainda</p>
              </div>
            ) : (
              entries.map((e) => (
                <div key={e.id} style={styles.prontuarioEntry}>
                  <div style={styles.prontuarioEntryHeader}>
                    <span style={styles.prontuarioEntryType}>{PRONTUARIO_TYPES.find((t) => t.value === e.type)?.label || e.type}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={styles.prontuarioEntryDate}>{formatDatePt(e.date)}</span>
                      {isSecretaria && (
                        <button
                          type="button"
                          className="btn tap"
                          style={styles.smallIconBtn}
                          onClick={() => setConfirmDeleteEntry(e.id)}
                          aria-label="Excluir registro"
                        >
                          <Trash2 size={14} color="#A03B2E" />
                        </button>
                      )}
                    </div>
                  </div>
                  {e.text && <p style={styles.prontuarioEntryText}>{e.text}</p>}
                </div>
              ))
            )}
          </div>

          {confirmDeleteEntry && (
            <ConfirmModal
              message="Excluir este registro do prontuário? Essa ação não pode ser desfeita."
              onCancel={() => setConfirmDeleteEntry(null)}
              onConfirm={() => handleDeleteEntry(confirmDeleteEntry)}
            />
          )}
        </>
      )}
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
            <X size={18} color="#3A3934" />
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
  shellWide: { maxWidth: 1180 },
  controlsWrap: { maxWidth: 640 },
  header: { display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 18 },
  headerActions: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap", position: "relative" },
  headerTitleBlock: { textAlign: "center" },
  headerEyebrow: { fontSize: 11, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: "#7A9B8E" },
  headerTitle: { fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 700, margin: "2px 0 0", color: "#233B34" },
  savingTag: { fontSize: 11, color: "#3A3934" },
  switchBtn: { background: "#fff", border: "1px solid #E3E1D9", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, color: "#3A3934" },
  financeBtn: { display: "flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, color: "#3A3934" },
  iconBtnActive: { background: "#233B34", borderColor: "#233B34" },
  bellDot: { position: "absolute", top: -4, right: -4, background: "#C24A38", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 99, minWidth: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px", lineHeight: 1 },
  notifDropdown: { position: "absolute", top: 42, right: 0, width: 300, maxHeight: 360, overflowY: "auto", background: "#fff", border: "1px solid #E3E1D9", borderRadius: 12, boxShadow: "0 12px 32px rgba(35,59,52,0.16)", zIndex: 60 },
  notifDropdownHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #ECEAE1", fontSize: 12.5, fontWeight: 700, color: "#233B34" },
  emptyNotif: { padding: "20px 14px", fontSize: 12.5, color: "#3A3934", textAlign: "center" },
  notifItem: { padding: "10px 12px", borderBottom: "1px solid #F3F2ED" },
  notifActionBtn: { marginTop: 6, background: "#233B34", color: "#fff", border: "none", borderRadius: 7, padding: "5px 10px", fontSize: 11.5, fontWeight: 700 },
  errorBanner: { background: "#FBE9E7", color: "#A03B2E", padding: "10px 12px", borderRadius: 10, fontSize: 13, marginBottom: 12 },
  pendingBanner: { display: "flex", alignItems: "flex-start", gap: 8, background: "#FBF0DE", color: "#8A5A15", padding: "10px 12px", borderRadius: 10, fontSize: 12.5, marginBottom: 12, lineHeight: 1.4 },
  cardPending: { background: "#FFFDF5", border: "1px solid #EEDFA0" },
  cardCancelled: { background: "#FDF4F2", border: "1px solid #F3C9C2" },
  expandPanel: { display: "flex", flexDirection: "column", gap: 4, background: "#FAF9F5", borderRadius: 8, padding: "8px 10px", marginTop: 8, fontSize: 12.5, color: "#3A3934" },
  expandRow: { display: "flex", justifyContent: "space-between", gap: 10 },
  inlineNotice: { display: "flex", alignItems: "flex-start", gap: 6, fontSize: 12, color: "#8A5A15", marginTop: 8, lineHeight: 1.4 },
  inlineNoticeDanger: { color: "#A03B2E" },
  inlineNoticeInfo: { color: "#2F6F63" },
  inlineNoticeStatic: { marginTop: 0, background: "#FBF0DE", padding: "9px 10px", borderRadius: 9 },
  resolveBtn: { marginTop: 8, background: "#233B34", color: "#fff", border: "none", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 },
  requestActionBtn: { display: "flex", alignItems: "center", gap: 6, marginTop: 9, background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, color: "#3A3934" },
  noticeOkBtn: { display: "block", marginTop: 6, background: "#233B34", color: "#fff", border: "none", borderRadius: 7, padding: "6px 10px", fontSize: 11.5, fontWeight: 700 },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 8, flexWrap: "wrap" },
  dateNav: { display: "flex", alignItems: "center", gap: 6 },
  iconBtn: { width: 34, height: 34, borderRadius: 9, background: "#fff", border: "1px solid #E3E1D9", display: "flex", alignItems: "center", justifyContent: "center" },
  dateChip: { display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 9, padding: "8px 12px", fontSize: 13.5, fontWeight: 600, color: "#233B34" },
  dateChipInactive: { opacity: 0.55 },
  pill: { background: "#fff", border: "1px solid #E3E1D9", borderRadius: 99, padding: "7px 13px", fontSize: 12.5, color: "#3A3934" },
  pillActive: { background: "#233B34", color: "#fff", borderColor: "#233B34" },
  searchRow: { display: "flex", alignItems: "center", gap: 8, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 10, padding: "9px 12px", marginBottom: 10 },
  searchInput: { border: "none", outline: "none", flex: 1, fontSize: 14, background: "transparent" },
  list: { display: "flex", flexDirection: "column", marginTop: 6 },
  weekGrid: { display: "grid", gridTemplateColumns: "repeat(7, minmax(130px, 1fr))", gap: 10, marginTop: 10, overflowX: "auto", paddingBottom: 8 },
  weekCol: { display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, minHeight: 220, overflow: "hidden" },
  weekColHeader: { display: "flex", flexDirection: "column", alignItems: "center", padding: "10px 6px 8px", borderBottom: "1px solid #ECEAE1", position: "relative" },
  weekColHeaderToday: { background: "#EEF2F0" },
  weekColLetter: { fontSize: 11, fontWeight: 700, color: "#5B5A52", textTransform: "uppercase" },
  weekColNum: { fontSize: 20, fontWeight: 800, color: "#233B34", lineHeight: 1.2 },
  weekColMonth: { fontSize: 10.5, color: "#5B5A52", textTransform: "capitalize" },
  weekTodayDot: { position: "absolute", top: 8, right: 10, width: 7, height: 7, borderRadius: 99, background: "#2F6F63" },
  weekColBody: { display: "flex", flexDirection: "column", gap: 6, padding: 8, flex: 1 },
  weekColEmpty: { textAlign: "center", fontSize: 12, color: "#B0AD9F", padding: "10px 0" },
  weekChip: { textAlign: "left", background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 8, padding: "6px 8px", display: "flex", flexDirection: "column", gap: 1, width: "100%" },
  weekChipTime: { fontSize: 11, fontWeight: 700, color: "#233B34" },
  weekChipName: { fontSize: 12.5, fontWeight: 600, color: "#2B2A26", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  weekChipDoctor: { fontSize: 10.5, color: "#5B5A52", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  weekAddBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 2, background: "transparent", border: "1px dashed #C9C6BA", borderRadius: 8, padding: "6px 8px", fontSize: 11.5, fontWeight: 600, color: "#2F6F63" },
  todayTag: { background: "#233B34", color: "#fff", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 7px", borderRadius: 5 },
  dateHeader: { display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 800, color: "#233B34", marginBottom: 10, paddingLeft: 2, paddingTop: 6, borderTop: "1px solid #ECEAE1" },
  emptyState: { textAlign: "center", padding: "48px 20px", color: "#3A3934", fontSize: 14 },
  card: { display: "flex", gap: 12, background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "13px 14px", marginBottom: 9, alignItems: "flex-start" },
  cardTime: { display: "flex", flexDirection: "column", alignItems: "center", gap: 3, fontSize: 12.5, fontWeight: 700, color: "#233B34", paddingTop: 2, minWidth: 44 },
  cardName: { fontWeight: 700, fontSize: 15.5, color: "#233B34", marginBottom: 5 },
  cardMetaRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  statusBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99 },
  typeBadge: { display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, padding: "3px 9px", borderRadius: 99, background: "#EEF2F0", color: "#2F6F63" },
  cardMetaItem: { display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "#3A3934" },
  cardNotes: { display: "flex", gap: 6, marginTop: 7, fontSize: 12.5, color: "#3A3934", lineHeight: 1.4 },
  cardActions: { display: "flex", flexDirection: "column", gap: 6 },
  smallIconBtn: { width: 28, height: 28, borderRadius: 7, background: "#F7F6F1", border: "1px solid #ECEAE1", display: "flex", alignItems: "center", justifyContent: "center" },
  fab: { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "#2F6F63", color: "#fff", border: "none", borderRadius: 99, padding: "14px 22px", fontSize: 14.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 8, boxShadow: "0 8px 24px rgba(47,111,99,0.35)" },
  roleWrap: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  roleCard: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 18, padding: "32px 26px", maxWidth: 340, width: "100%", textAlign: "center", boxShadow: "0 12px 32px rgba(35,59,52,0.08)" },
  roleTitle: { fontFamily: FONT_DISPLAY, fontSize: 24, fontWeight: 700, color: "#233B34", margin: "12px 0 4px" },
  roleSubtitle: { fontSize: 13.5, color: "#3A3934", margin: "0 0 22px" },
  roleBtnPrimary: { width: "100%", background: "#2F6F63", color: "#fff", border: "none", borderRadius: 11, padding: "13px 16px", fontSize: 14.5, fontWeight: 700, marginBottom: 10 },
  roleBtnSecondary: { width: "100%", background: "#fff", color: "#233B34", border: "1px solid #E3E1D9", borderRadius: 11, padding: "13px 16px", fontSize: 14.5, fontWeight: 600 },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(35,40,36,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: 16 },
  modal: { background: "#fff", width: "100%", maxWidth: 480, borderRadius: 18, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(35,59,52,0.28)" },
  modalHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 18px 6px" },
  modalTitle: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, color: "#233B34", margin: 0 },
  form: { display: "flex", flexDirection: "column", gap: 13, padding: "10px 18px 24px" },
  label: { display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#3A3934" },
  input: { border: "1px solid #E3E1D9", borderRadius: 9, padding: "11px 12px", fontSize: 14.5, color: "#2B2A26", background: "#FDFCFA" },
  moneyPrefix: { position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#3A3934", fontSize: 14.5, pointerEvents: "none" },
  inputConflict: { borderColor: "#C24A38", background: "#FDF4F2" },
  row2: { display: "flex", gap: 10 },
  statusOptions: { display: "flex", gap: 8, flexWrap: "wrap" },
  statusOption: { display: "flex", alignItems: "center", gap: 5, border: "1.5px solid", borderRadius: 9, padding: "8px 12px", fontSize: 12.5, fontWeight: 700 },
  submitBtn: { background: "#233B34", color: "#fff", border: "none", borderRadius: 11, padding: "14px 16px", fontSize: 15, fontWeight: 700, marginTop: 6 },
  submitBtnDisabled: { background: "#B0AD9F", cursor: "not-allowed" },
  cancelBtn: { flex: 1, background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 600, color: "#3A3934" },
  deleteBtn: { flex: 1, background: "#C24A38", color: "#fff", border: "none", borderRadius: 9, padding: "11px", fontSize: 13.5, fontWeight: 700 },
  deleteLinkBtn: { display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "transparent", border: "none", padding: "10px", fontSize: 13, fontWeight: 600, color: "#A03B2E" },
  doctorRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#FAF9F5", border: "1px solid #ECEAE1", borderRadius: 9, padding: "9px 12px" },
  addDoctorBtn: { width: 44, background: "#2F6F63", border: "none", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center" },
  backLink: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", padding: "4px 0", fontSize: 13, color: "#3A3934", marginBottom: 14, fontWeight: 600 },
  financeFilters: { display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" },
  statGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 },
  statCard: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "14px 14px" },
  statCardLabel: { fontSize: 11.5, color: "#3A3934", fontWeight: 600, marginBottom: 5 },
  statCardValue: { fontFamily: FONT_DISPLAY, fontSize: 19, fontWeight: 700, color: "#233B34" },
  financeSection: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "14px 16px", marginBottom: 12 },
  financeSectionTitle: { fontFamily: FONT_DISPLAY, fontSize: 15, fontWeight: 700, color: "#233B34", margin: "0 0 10px" },
  financeWrap: { maxWidth: 640 },
  financeTitle: { fontFamily: FONT_DISPLAY, fontSize: 21, fontWeight: 700, color: "#233B34", margin: "10px 0 14px" },
  patientRow: { display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: "12px 14px", width: "100%", textAlign: "left" },
  patientRowName: { fontSize: 14.5, fontWeight: 700, color: "#2B2A26" },
  patientRowMeta: { fontSize: 12, color: "#5B5A52", marginTop: 2 },
  prontuarioCounters: { display: "flex", gap: 16, flexWrap: "wrap", background: "#F7F6F1", border: "1px solid #ECEAE1", borderRadius: 12, padding: "12px 14px", marginBottom: 16, fontSize: 13.5, color: "#3A3934" },
  prontuarioForm: { display: "flex", flexDirection: "column", gap: 12, background: "#fff", border: "1px solid #ECEAE1", borderRadius: 12, padding: 14, marginBottom: 16 },
  prontuarioEntry: { background: "#fff", border: "1px solid #ECEAE1", borderRadius: 10, padding: "10px 12px", marginBottom: 8 },
  prontuarioEntryHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  prontuarioEntryType: { fontSize: 12.5, fontWeight: 700, color: "#2F6F63" },
  prontuarioEntryDate: { fontSize: 12, color: "#5B5A52" },
  prontuarioEntryText: { margin: "6px 0 0", fontSize: 13, color: "#2B2A26", lineHeight: 1.4 },
  financeRow: { display: "flex", justifyContent: "space-between", fontSize: 13.5, color: "#3A3934", padding: "6px 0", borderBottom: "1px solid #F3F2ED" },
  financeEmpty: { fontSize: 13, color: "#3A3934", margin: 0 },
  chartRow: { display: "flex", alignItems: "center", gap: 16, marginBottom: 12, flexWrap: "wrap" },
  exportRow: { display: "flex", gap: 10, marginTop: 6, marginBottom: 100 },
  exportBtn: { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, background: "#fff", border: "1px solid #E3E1D9", borderRadius: 10, padding: "12px", fontSize: 13.5, fontWeight: 700, color: "#233B34" },
};
