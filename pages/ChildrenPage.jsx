import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '@renderer/api';
import ChildModal from '@components/ChildModal';
import Modal from '@components/Modal';
import damubalaLogo from '@renderer/assets/import-logos/damubala.ico';
import qosymshaLogo from '@renderer/assets/import-logos/qosymsha.png';
import artsportLogo from '@renderer/assets/import-logos/artsport.ico';

const paidReportFields = [
  { key: 'cityName', label: 'Город' },
  { key: 'studioName', label: 'Студия' },
  { key: 'childName', label: 'ФИО ребенка' },
  { key: 'childIIN', label: 'ИИН ребенка' },
  { key: 'childBirthDate', label: 'Дата рождения' },
  { key: 'childAge', label: 'Возраст' },
  { key: 'courseName', label: 'Кружок' },
  { key: 'groupName', label: 'Группа' },
  { key: 'parentName', label: 'ФИО родителя' },
  { key: 'lastPaymentDate', label: 'Дата последней оплаты' },
  { key: 'paymentStartDate', label: 'Старт оплаты' },
  { key: 'lessonsCount', label: 'Уроков после оплаты' },
  { key: 'parentPhone', label: 'Номер телефона' },
  { key: 'messageTag', label: 'Пометка' }
];

const voucherReportFields = [
  { key: 'cityName', label: 'Город' },
  { key: 'studioName', label: 'Студия' },
  { key: 'childName', label: 'ФИО ребенка' },
  { key: 'childIIN', label: 'ИИН ребенка' },
  { key: 'childBirthDate', label: 'Дата рождения' },
  { key: 'childAge', label: 'Возраст' },
  { key: 'courseName', label: 'Кружок' },
  { key: 'groupName', label: 'Группа' },
  { key: 'parentName', label: 'ФИО родителя' },
  { key: 'parentIIN', label: 'ИИН родителя' },
  { key: 'parentEmail', label: 'Email родителя' },
  { key: 'voucherNumber', label: 'Номер ваучера' },
  { key: 'enrollmentDate', label: 'Дата зачисления' },
  { key: 'voucherEndDate', label: 'Дата окончания ваучера' },
  { key: 'importSource', label: 'Источник импорта' },
  { key: 'parentPhone', label: 'Номер телефона' },
  { key: 'messageTag', label: 'Пометка' }
];

const queueReportFields = [
  { key: 'cityName', label: 'Город' },
  { key: 'studioName', label: 'Студия' },
  { key: 'childFullName', label: 'ФИО ребенка' },
  { key: 'childIIN', label: 'ИИН ребенка' },
  { key: 'childAge', label: 'Возраст' },
  { key: 'parentFullName', label: 'ФИО родителя' },
  { key: 'parentIIN', label: 'ИИН родителя' },
  { key: 'phone', label: 'Номер телефона' },
  { key: 'queueCategory', label: 'Категория очереди' },
  { key: 'queueDate', label: 'Дата очереди' },
  { key: 'queueNumber', label: 'Номер очереди' }
];

function getReportFieldsByList(type) {
  if (type === 'queue') return queueReportFields;
  if (type === 'voucher') return voucherReportFields;
  return paidReportFields;
}

function getReportValue(row, key) {
  if (key === 'queueNumber') return formatQueueNumber(row.queueNumber);
  if (key === 'messageTag') return messageTagLabel(row.messageTag);
  return row[key] ?? '';
}

function formatQueueNumber(queueNumber) {
  const normalized = String(queueNumber ?? '').trim();
  if (!normalized) return '—';
  if (normalized.toUpperCase() === 'ВАУЧЕР') return 'ВАУЧЕР';
  return normalized;
}

function renderQueueShiftBadge(queueShift) {
  if (queueShift === null || queueShift === undefined) return '—';
  const numeric = Number(queueShift);
  const label = numeric === 0 ? '0' : `${numeric > 0 ? '+' : ''}${numeric}`;
  const style = {
    display: 'inline-flex',
    minWidth: 52,
    justifyContent: 'center',
    alignItems: 'center',
    padding: '6px 10px',
    borderRadius: 999,
    fontWeight: 700,
    border: '1px solid rgba(111, 135, 170, 0.35)',
    color: '#d7e6ff'
  };
  if (numeric < 0) {
    style.color = '#73e7a5';
    style.background = 'rgba(31, 95, 56, 0.28)';
    style.border = '1px solid rgba(115, 231, 165, 0.35)';
  } else if (numeric > 0) {
    style.color = '#ff8e8e';
    style.background = 'rgba(120, 35, 35, 0.24)';
    style.border = '1px solid rgba(255, 142, 142, 0.35)';
  } else {
    style.color = '#9eb4d4';
    style.background = 'rgba(64, 84, 112, 0.22)';
  }
  return <span style={style}>{label}</span>;
}

function parseBirthDateFromIIN(iinRaw) {
  const iin = String(iinRaw || '').replace(/\D/g, '');
  if (iin.length < 6) return '';
  const yy = Number(iin.slice(0, 2));
  const mm = Number(iin.slice(2, 4));
  const dd = Number(iin.slice(4, 6));
  const nowYY = new Date().getFullYear() % 100;
  const year = yy <= nowYY ? 2000 + yy : 1900 + yy;
  const date = new Date(year, mm - 1, dd);
  if (date.getFullYear() !== year || date.getMonth() !== mm - 1 || date.getDate() !== dd) return '';
  return `${String(year).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function ageFromBirthDate(isoDate) {
  if (!isoDate) return '';
  const birth = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : '';
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(baseIso, days) {
  const d = new Date(`${baseIso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return baseIso;
  d.setDate(d.getDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

function formatQueueUpdatedAt(value) {
  if (!value) return '—';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return String(value);
  return dt.toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getQueueRowShiftStyle(queueShift) {
  const numeric = Number(queueShift);
  if (!Number.isFinite(numeric) || numeric === 0) return undefined;
  if (numeric < 0) {
    return { background: 'rgba(27, 74, 47, 0.18)' };
  }
  return { background: 'rgba(92, 31, 31, 0.16)' };
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function asIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [dd, mm, yyyy] = raw.split('.');
    return `${yyyy}-${mm}-${dd}`;
  }
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return '';
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function getQueueRowMissingFields(row) {
  const checks = [
    { key: 'childFullName', title: 'ФИО ребенка', value: row['ФИО ребенка'] || row.childFullName },
    { key: 'childIIN', title: 'ИИН ребенка', value: row['ИИН ребенка'] || row.childIIN },
    { key: 'parentFullName', title: 'ФИО родителя', value: row['ФИО родителя'] || row.parentFullName },
    { key: 'parentIIN', title: 'ИИН родителя', value: row['ИИН родителя'] || row.parentIIN },
    { key: 'phone', title: 'Телефон', value: row['Телефон'] || row.phone },
    { key: 'queueDate', title: 'Дата очереди', value: row['Дата очереди'] || row.queueDate },
    { key: 'queueNumber', title: 'Номер очереди', value: row['Номер очереди'] || row.queueNumber },
    { key: 'queueCategory', title: 'Категория очереди', value: row['Категория очереди'] || row.queueCategory }
  ];
  return checks.filter((x) => String(x.value || '').trim() === '');
}

function compareValues(a, b, direction = 'asc') {
  const dir = direction === 'desc' ? -1 : 1;
  const av = a ?? '';
  const bv = b ?? '';
  const an = Number(av);
  const bn = Number(bv);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && String(av).trim() !== '' && String(bv).trim() !== '') {
    return (an - bn) * dir;
  }
  return String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' }) * dir;
}

function messageTagLabel(tag) {
  const normalized = String(tag || '').trim().toLowerCase();
  if (normalized === 'qr') return 'QR';
  if (normalized === 'reminder') return 'Напоминание';
  if (String(tag || '').trim()) return String(tag || '').trim();
  return '—';
}

function isTagEqual(value, expected) {
  return String(value || '').trim().toLowerCase() === String(expected || '').trim().toLowerCase();
}

function getMessageTagPreset(tag) {
  const normalized = String(tag || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized === 'qr') return 'qr';
  if (normalized === 'reminder' || normalized === 'напоминание') return 'reminder';
  return 'custom';
}

function normalizeImportSource(source) {
  const key = String(source || '').trim().toLowerCase();
  if (key === 'damubala') return 'damubala';
  if (key === 'qosymsha') return 'qosymsha';
  if (key === 'artsport') return 'artsport';
  if (key === 'excel') return 'excel';
  return '';
}

function getImportSourceMeta(source) {
  const key = normalizeImportSource(source);
  if (key === 'damubala') return { key, label: 'Damubala', logo: damubalaLogo };
  if (key === 'qosymsha') return { key, label: 'Qosymsha', logo: qosymshaLogo };
  if (key === 'artsport') return { key, label: 'Artsport', logo: artsportLogo };
  if (key === 'excel') return { key, label: 'Excel', logo: null };
  return null;
}

function qosymshaChildKey(item, index) {
  return [
    String(item?.childIIN || '').trim(),
    String(item?.parentIIN || '').trim(),
    String(item?.childFullName || '').trim().toLowerCase(),
    index
  ].join('|');
}

function resolveEntityName(list, id) {
  const numericId = Number(id || 0);
  if (!numericId) return '—';
  return list.find((item) => Number(item.id) === numericId)?.name || '—';
}

export default function ChildrenPage() {
  const location = useLocation();
  const [children, setChildren] = useState([]);
  const [childrenCounts, setChildrenCounts] = useState({ paid: 0, voucher: 0, archived: 0 });
  const [queueChildren, setQueueChildren] = useState([]);
  const [cities, setCities] = useState([]);
  const [studios, setStudios] = useState([]);
  const [courses, setCourses] = useState([]);
  const [groups, setGroups] = useState([]);
  const [modalData, setModalData] = useState(null);
  const [selectedChild, setSelectedChild] = useState(null);
  const [selectedChildTagDraft, setSelectedChildTagDraft] = useState('');
  const [selectedChildTagSaving, setSelectedChildTagSaving] = useState(false);
  const [transferModalData, setTransferModalData] = useState(null);
  const [transferGroupsOptions, setTransferGroupsOptions] = useState([]);
  const [transferSaving, setTransferSaving] = useState(false);
  const [selectedQueueChild, setSelectedQueueChild] = useState(null);
  const [selectedArchivedEntity, setSelectedArchivedEntity] = useState(null);
  const [queueModalData, setQueueModalData] = useState(null);

  const [cityFilter, setCityFilter] = useState('');
  const [studioFilter, setStudioFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [messageTagFilter, setMessageTagFilter] = useState('');
  const [activeList, setActiveList] = useState(() => {
    const params = new URLSearchParams(location.search);
    const type = params.get('type');
    return type === 'voucher' || type === 'paid' || type === 'archived' ? type : 'paid';
  });
  const [archivedCategory, setArchivedCategory] = useState('paid');

  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [archivedEntities, setArchivedEntities] = useState([]);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportSelected, setReportSelected] = useState(getReportFieldsByList(activeList).map((x) => x.key));
  const [queueRefreshing, setQueueRefreshing] = useState(false);
  const [queueRefreshOpen, setQueueRefreshOpen] = useState(false);
  const [queueRefreshResult, setQueueRefreshResult] = useState(null);
  const [queueRefreshProgress, setQueueRefreshProgress] = useState(0);
  const [queueToVoucherData, setQueueToVoucherData] = useState(null);
  const [childrenSort, setChildrenSort] = useState({ key: 'childName', direction: 'asc' });
  const [queueSort, setQueueSort] = useState({ key: 'childFullName', direction: 'asc' });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState({});
  const [selectedCourseForBulk, setSelectedCourseForBulk] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importSource, setImportSource] = useState('excel');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [damubalaSyncing, setDamubalaSyncing] = useState(false);
  const [damubalaSyncModalOpen, setDamubalaSyncModalOpen] = useState(false);
  const [damubalaSyncLoadingText, setDamubalaSyncLoadingText] = useState('');
  const [damubalaPreview, setDamubalaPreview] = useState(null);
  const [damubalaSelectedApps, setDamubalaSelectedApps] = useState({});
  const [qosymshaSyncing, setQosymshaSyncing] = useState(false);
  const [qosymshaSyncModalOpen, setQosymshaSyncModalOpen] = useState(false);
  const [qosymshaSyncLoadingText, setQosymshaSyncLoadingText] = useState('');
  const [qosymshaSyncProgress, setQosymshaSyncProgress] = useState(0);
  const [qosymshaPreview, setQosymshaPreview] = useState(null);
  const [qosymshaSelectedChildren, setQosymshaSelectedChildren] = useState({});
  const [qosymshaImportResult, setQosymshaImportResult] = useState(null);
  const [artsportSyncing, setArtsportSyncing] = useState(false);
  const [artsportSyncModalOpen, setArtsportSyncModalOpen] = useState(false);
  const [artsportSyncLoadingText, setArtsportSyncLoadingText] = useState('');
  const [artsportSyncProgress, setArtsportSyncProgress] = useState(0);
  const [artsportPreview, setArtsportPreview] = useState(null);
  const [artsportSelectedChildren, setArtsportSelectedChildren] = useState({});
  const [artsportImportResult, setArtsportImportResult] = useState(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditData, setBulkEditData] = useState({ cityId: '', studioId: '', courseId: '', messageTag: '', messageTagMode: '', voucherNumber: '' });
  const importInputRef = useRef(null);

  useEffect(() => {
    if (!queueRefreshing) return undefined;
    const timer = window.setInterval(() => {
      setQueueRefreshProgress((prev) => {
        if (prev >= 94) return prev;
        if (prev < 35) return Math.min(prev + 7, 94);
        if (prev < 70) return Math.min(prev + 4, 94);
        return Math.min(prev + 2, 94);
      });
    }, 180);
    return () => window.clearInterval(timer);
  }, [queueRefreshing]);

  useEffect(() => {
    if (!api.onQosymshaProgress) return undefined;
    const unsubscribe = api.onQosymshaProgress((payload = {}) => {
      const nextText = String(payload.message || '').trim();
      const nextPercent = Number(payload.percent || 0);
      if (nextText) setQosymshaSyncLoadingText(nextText);
      if (Number.isFinite(nextPercent)) setQosymshaSyncProgress(Math.max(0, Math.min(100, nextPercent)));
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!api.onArtsportProgress) return undefined;
    const unsubscribe = api.onArtsportProgress((payload = {}) => {
      const nextText = String(payload.message || '').trim();
      const nextPercent = Number(payload.percent || 0);
      if (nextText) setArtsportSyncLoadingText(nextText);
      if (Number.isFinite(nextPercent)) setArtsportSyncProgress(Math.max(0, Math.min(100, nextPercent)));
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  async function loadMeta() {
    const [cityList, studioList, courseList] = await Promise.all([api.listCities(), api.listStudios(), api.listCourses()]);
    setCities(cityList);
    setStudios(studioList);
    setCourses(courseList);

    const groupLists = await Promise.all(courseList.map((course) => api.listGroups(course.id)));
    setGroups(groupLists.flat());
  }

  async function loadChildren() {
    if (activeList === 'queue' || activeList === 'archived') return;
    const list = await api.listChildren({
      cityId: cityFilter ? Number(cityFilter) : undefined,
      studioId: studioFilter ? Number(studioFilter) : undefined,
      courseId: courseFilter ? Number(courseFilter) : undefined,
      messageTag: activeList === 'voucher' ? (messageTagFilter || undefined) : undefined,
      type: activeList === 'paid' || activeList === 'voucher' ? activeList : undefined
    });
    setChildren(list);
  }

  async function loadChildrenCounts() {
    const [list, archived] = await Promise.all([api.listChildren({
      cityId: cityFilter ? Number(cityFilter) : undefined,
      studioId: studioFilter ? Number(studioFilter) : undefined,
      courseId: courseFilter ? Number(courseFilter) : undefined
    }), api.listArchivedEntities({})]);
    setChildrenCounts({
      paid: list.filter((x) => x.type === 'paid').length,
      voucher: list.filter((x) => x.type === 'voucher').length,
      archived: Array.isArray(archived) ? archived.length : 0
    });
  }

  async function loadQueueChildren() {
    const list = await api.listQueueChildren({
      cityId: cityFilter ? Number(cityFilter) : undefined,
      studioId: studioFilter ? Number(studioFilter) : undefined
    });
    setQueueChildren(list);
    if (selectedQueueChild?.id) {
      const refreshed = list.find((x) => x.id === selectedQueueChild.id);
      if (refreshed) setSelectedQueueChild(refreshed);
    }
  }

  async function loadArchivedEntities() {
    const list = await api.listArchivedEntities({});
    setArchivedEntities(Array.isArray(list) ? list : []);
  }

  async function loadAll() {
    await loadMeta();
    await loadChildren();
    await loadArchivedEntities();
  }

  async function openEdit(childId) {
    const full = await api.getChild(childId);
    if (full) setModalData(full);
  }

  async function openProfile(row) {
    const full = await api.getChild(row.id);
    if (full) {
      setSelectedChild({ ...full, _meta: row });
    }
  }

  function openTransferModal(child) {
    if (!child || child.type !== 'paid') return;
    setTransferModalData({
      childId: child.id,
      studioId: String(child.studioId || ''),
      courseId: String(child.courseId || ''),
      groupId: String(child.groupId || ''),
      effectiveDate: addDays(todayIso(), 1)
    });
  }

  async function submitTransferChild() {
    if (!selectedChild || !transferModalData) return;
    if (!transferModalData.studioId || !transferModalData.courseId || !transferModalData.groupId || !transferModalData.effectiveDate) {
      setError('Заполните студию, кружок, группу и дату перевода.');
      return;
    }
    setTransferSaving(true);
    try {
      await api.saveChild({
        id: selectedChild.id,
        studioId: Number(transferModalData.studioId),
        courseId: Number(transferModalData.courseId),
        groupId: Number(transferModalData.groupId),
        transferEffectiveDate: transferModalData.effectiveDate,
        type: selectedChild.type,
        messageTag: selectedChild.messageTag || '',
        profile: selectedChild.profile
      });
      const refreshed = await api.getChild(selectedChild.id);
      if (refreshed) {
        const rowMeta = children.find((row) => Number(row.id) === Number(selectedChild.id)) || selectedChild._meta || {};
        setSelectedChild({ ...refreshed, _meta: { ...rowMeta, cityName: refreshed.cityName, studioName: refreshed.studioName, courseName: refreshed.courseName, groupName: refreshed.groupName } });
      }
      setTransferModalData(null);
      await loadChildren();
      await loadChildrenCounts();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось перевести ребенка.');
    } finally {
      setTransferSaving(false);
    }
  }

  async function saveSelectedChildTag() {
    if (!selectedChild || selectedChild.type !== 'voucher') return;
    setSelectedChildTagSaving(true);
    try {
      await api.saveChild({
        id: selectedChild.id,
        studioId: selectedChild.studioId,
        courseId: selectedChild.courseId,
        groupId: selectedChild.groupId,
        type: selectedChild.type,
        messageTag: selectedChildTagDraft || '',
        profile: selectedChild.profile
      });
      const refreshed = await api.getChild(selectedChild.id);
      if (refreshed) {
        setSelectedChild((prev) => ({ ...refreshed, _meta: prev?._meta }));
      }
      await loadChildren();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось обновить пометку.');
    } finally {
      setSelectedChildTagSaving(false);
    }
  }

  useEffect(() => {
    loadAll();
    loadQueueChildren();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const type = params.get('type');
    const q = params.get('q');
    if (type === 'voucher' || type === 'paid' || type === 'archived') setActiveList(type);
    if (q !== null) setSearch(q);
  }, [location.search]);

  useEffect(() => {
    const fields = getReportFieldsByList(activeList);
    setReportSelected(fields.map((x) => x.key));
  }, [activeList]);

  useEffect(() => {
    setSelectionMode(false);
    setSelectedIds({});
    setSelectedCourseForBulk('');
    if (activeList !== 'voucher') setMessageTagFilter('');
  }, [activeList]);

  useEffect(() => {
    async function loadTransferGroups() {
      if (!transferModalData?.courseId) {
        setTransferGroupsOptions([]);
        return;
      }
      const list = await api.listGroups(Number(transferModalData.courseId));
      setTransferGroupsOptions(Array.isArray(list) ? list : []);
    }
    loadTransferGroups();
  }, [transferModalData?.courseId]);

  useEffect(() => {
    loadChildren();
    loadChildrenCounts();
    loadQueueChildren();
    loadArchivedEntities();
  }, [cityFilter, studioFilter, courseFilter, messageTagFilter, activeList]);

  useEffect(() => {
    setSelectedChildTagDraft(selectedChild?.messageTag || '');
  }, [selectedChild?.id, selectedChild?.messageTag]);

  const filteredStudios = useMemo(
    () => studios.filter((s) => !cityFilter || Number(s.cityId) === Number(cityFilter)),
    [studios, cityFilter]
  );

  const filteredCourses = useMemo(
    () => courses.filter((c) => !studioFilter || Number(c.studioId) === Number(studioFilter)),
    [courses, studioFilter]
  );
  const selectableVoucherCourses = useMemo(() => {
    if (!studioFilter) return courses;
    return courses.filter((course) => Number(course.studioId) === Number(studioFilter));
  }, [courses, studioFilter]);
  const transferStudios = useMemo(() => studios, [studios]);
  const paidTransferCourses = useMemo(
    () => courses.filter((course) => Number(course.studioId) === Number(transferModalData?.studioId || 0)),
    [courses, transferModalData?.studioId]
  );

  const filteredRows = useMemo(() => {
    if (activeList === 'queue' || activeList === 'archived') return [];
    if (!search.trim()) return children;
    const q = search.toLowerCase();
    return children.filter((x) =>
      [x.childName, x.cityName, x.studioName, x.courseName, x.groupName, x.parentPhone, messageTagLabel(x.messageTag)]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [children, search, activeList]);

  const filteredQueueRows = useMemo(() => {
    if (activeList !== 'queue') return [];
    if (!search.trim()) return queueChildren;
    const q = search.toLowerCase();
    return queueChildren.filter((x) =>
      [
        x.childFullName,
        x.childIIN,
        x.parentFullName,
        x.parentIIN,
        x.phone,
        x.cityName,
        x.studioName,
        x.childBirthDate,
        x.childAge,
        x.queueCategory,
        x.comment,
        x.queueNumber
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [queueChildren, search, activeList]);

  const filteredArchivedRows = useMemo(() => {
    if (activeList !== 'archived') return [];
    const q = search.trim().toLowerCase();
    return archivedEntities
      .filter((row) => row.entityCategory === archivedCategory)
      .filter((row) => {
        if (!q) return true;
        return [
          row.entityName,
          row.snapshot?.childIIN,
          row.snapshot?.parentPhone,
          row.snapshot?.queueNumber,
          row.snapshot?.voucherNumber
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q));
      });
  }, [activeList, archivedEntities, archivedCategory, search]);

  const sortedRows = useMemo(() => {
    const rows = [...filteredRows];
    rows.sort((a, b) => compareValues(a[childrenSort.key], b[childrenSort.key], childrenSort.direction));
    return rows;
  }, [filteredRows, childrenSort]);

  const sortedQueueRows = useMemo(() => {
    const rows = [...filteredQueueRows];
    rows.sort((a, b) => {
      if (queueSort.key === 'queueNumber') {
        const aq = String(a.queueNumber || '').trim().toUpperCase() === 'ВАУЧЕР' ? Number.MAX_SAFE_INTEGER : Number(a.queueNumber || 0);
        const bq = String(b.queueNumber || '').trim().toUpperCase() === 'ВАУЧЕР' ? Number.MAX_SAFE_INTEGER : Number(b.queueNumber || 0);
        return compareValues(aq, bq, queueSort.direction);
      }
      return compareValues(a[queueSort.key], b[queueSort.key], queueSort.direction);
    });
    return rows;
  }, [filteredQueueRows, queueSort]);

  const selectableRows = useMemo(() => {
    if (activeList === 'queue') return sortedQueueRows;
    if (activeList === 'archived') return filteredArchivedRows;
    return sortedRows;
  }, [activeList, sortedRows, sortedQueueRows, filteredArchivedRows]);
  const selectedRows = useMemo(() => selectableRows.filter((row) => selectedIds[row.id]), [selectableRows, selectedIds]);

  function toggleChildrenSort(key) {
    setChildrenSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function toggleQueueSort(key) {
    setQueueSort((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  }

  function renderSortArrow(state, key) {
    if (state.key !== key) return '⇅';
    return state.direction === 'asc' ? '↑' : '↓';
  }

  function toggleSelected(rowId, checked) {
    setSelectedIds((prev) => ({ ...prev, [rowId]: checked }));
  }

  function selectAllVisible() {
    setSelectedIds(Object.fromEntries(selectableRows.map((row) => [row.id, true])));
  }

  function clearVisibleSelection() {
    setSelectedIds(Object.fromEntries(selectableRows.map((row) => [row.id, false])));
  }

  const allVisibleSelected = selectableRows.length > 0 && selectableRows.every((row) => !!selectedIds[row.id]);

  async function applyVoucherTag(tag) {
    const ids = selectedRows.map((row) => row.id);
    if (!ids.length) return;
    try {
      await api.setChildrenMessageTag({ ids, messageTag: tag });
      await loadChildren();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось обновить пометки.');
    }
  }

  async function applySelectedCourseToVouchers() {
    const ids = selectedRows.map((row) => row.id);
    const courseId = Number(selectedCourseForBulk || 0);
    if (!ids.length || !courseId) return;
    try {
      const res = await api.setChildrenCourse({ ids, courseId });
      await loadChildren();
      setError('');
      window.alert(`Кружок назначен для ${Number(res?.updated || 0)} детей.`);
    } catch (e) {
      setError(e?.message || 'Не удалось назначить кружок выбранным детям.');
    }
  }

  async function applyBulkEditToSelectedVouchers() {
    const ids = selectedRows.map((row) => row.id);
    if (!ids.length) return;
    try {
      for (const id of ids) {
        const full = await api.getChild(id);
        if (!full || full.type !== 'voucher') continue;
        const profile = { ...(full.profile || {}) };
        if (String(bulkEditData.voucherNumber || '').trim()) {
          profile.voucherNumber = String(bulkEditData.voucherNumber || '').trim();
        }
        await api.saveChild({
          id: full.id,
          studioId: bulkEditData.studioId ? Number(bulkEditData.studioId) : full.studioId,
          courseId: bulkEditData.courseId ? Number(bulkEditData.courseId) : full.courseId,
          groupId: full.groupId,
          type: 'voucher',
          messageTag: bulkEditData.messageTag !== '' ? bulkEditData.messageTag : full.messageTag || '',
          profile
        });
      }
      setBulkEditOpen(false);
      await loadChildren();
      await loadChildrenCounts();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось применить изменения к выбранным детям.');
    }
  }

  async function deleteSelectedRows() {
    if (!selectedRows.length) return;
    const isQueue = activeList === 'queue';
    const isArchived = activeList === 'archived';
    const label = isArchived ? 'архивных записей' : (isQueue ? 'записей очереди' : 'детей');
    if (!window.confirm(`Удалить выбранных ${selectedRows.length} ${label}?`)) return;

    try {
      if (isArchived) {
        await Promise.all(selectedRows.map((row) => api.deleteArchivedEntity({ id: row.id })));
      } else if (isQueue) {
        await Promise.all(selectedRows.map((row) => api.deleteQueueChild(row.id)));
      } else {
        await Promise.all(selectedRows.map((row) => api.deleteChild(row.id)));
      }

      setSelectedIds({});
      setSelectedChild(null);
      setSelectedQueueChild(null);
      await loadChildren();
      await loadQueueChildren();
      await loadArchivedEntities();
      await loadChildrenCounts();
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось удалить выбранные записи.');
    }
  }

  function openDamubalaSyncModal() {
    setDamubalaPreview(null);
    setDamubalaSelectedApps({});
    setDamubalaSyncLoadingText('');
    setDamubalaSyncModalOpen(true);
  }

  async function startDamubalaPreviewLoad() {
    setDamubalaSyncing(true);
    setDamubalaSyncLoadingText('Окно Damubala открыто. Войдите в аккаунт...');
    const stageTimer = window.setTimeout(() => {
      setDamubalaSyncLoadingText('Вход выполнен. Загружаем заявки и детей из Damubala...');
    }, 8000);
    try {
      const preview = await api.fetchDamubalaVouchersPreview();
      if (!preview?.success) {
        throw new Error(preview?.message || 'Не удалось получить список заявок из Damubala.');
      }

      const apps = Array.isArray(preview.applications) ? preview.applications : [];
      const defaultSelection = Object.fromEntries(apps.map((app) => [app.applicationId, true]));
      setDamubalaSelectedApps(defaultSelection);
      setDamubalaPreview(preview);
      setDamubalaSyncLoadingText('');
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось получить данные из Damubala.');
    } finally {
      window.clearTimeout(stageTimer);
      setDamubalaSyncing(false);
    }
  }

  function toggleDamubalaApplication(applicationId, checked) {
    setDamubalaSelectedApps((prev) => ({ ...prev, [applicationId]: checked }));
  }

  function selectAllDamubalaApplications(checked) {
    if (!damubalaPreview?.applications?.length) return;
    setDamubalaSelectedApps(
      Object.fromEntries(damubalaPreview.applications.map((app) => [app.applicationId, checked]))
    );
  }

  async function importSelectedDamubalaChildren() {
    const items = Array.isArray(damubalaPreview?.items) ? damubalaPreview.items : [];
    const selectedAppIds = Object.entries(damubalaSelectedApps)
      .filter(([, selected]) => !!selected)
      .map(([id]) => Number(id))
      .filter(Boolean);

    if (!selectedAppIds.length) {
      setError('Выберите хотя бы один номер заявки.');
      return;
    }

    const selectedItems = items.filter((item) => selectedAppIds.includes(Number(item.applicationId || 0)));
    if (!selectedItems.length) {
      setError('По выбранным заявкам не найдено детей для импорта.');
      return;
    }

    setDamubalaSyncing(true);
    setDamubalaSyncLoadingText('Импортируем выбранных детей в базу...');
    try {
      const result = await api.syncDamubalaVouchers({
        fetched: Number(damubalaPreview?.fetched || selectedItems.length),
        items: selectedItems
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Не удалось синхронизировать данные.');
      }

      await loadChildren();
      await loadChildrenCounts();
      setError('');
      setDamubalaSyncModalOpen(false);

      window.alert(
        `Синхронизация завершена.\n` +
        `Выбрано заявок: ${selectedAppIds.length}\n` +
        `Получено из Damubala: ${result.fetched || 0}\n` +
        `Добавлено: ${result.added || 0}\n` +
        `Обновлено: ${result.updated || 0}\n` +
        `Пропущено: ${result.skipped || 0}\n` +
        `Новых детей: ${(result.newChildren || []).length}\n` +
        `${result.newChildren?.length ? `\nНайденные новые дети:\n${result.newChildren.join('\n')}\n` : ''}` +
        `Технический кружок: ${result.courseName || '—'}`
      );
    } catch (e) {
      setError(e?.message || 'Синхронизация с Damubala не удалась.');
    } finally {
      setDamubalaSyncing(false);
      setDamubalaSyncLoadingText('');
    }
  }

  function openQosymshaSyncModal() {
    setQosymshaPreview(null);
    setQosymshaSelectedChildren({});
    setQosymshaSyncLoadingText('');
    setQosymshaSyncProgress(0);
    setQosymshaImportResult(null);
    setQosymshaSyncModalOpen(true);
  }

  function openArtsportSyncModal() {
    setArtsportPreview(null);
    setArtsportSelectedChildren({});
    setArtsportSyncLoadingText('');
    setArtsportSyncProgress(0);
    setArtsportImportResult(null);
    setArtsportSyncModalOpen(true);
  }

  async function startQosymshaPreviewLoad() {
    setQosymshaSyncing(true);
    setQosymshaSyncLoadingText('Окно Qosymsha открыто. Войдите в аккаунт...');
    setQosymshaSyncProgress(4);
    try {
      const preview = await api.fetchQosymshaChildrenPreview();
      if (!preview?.success) {
        throw new Error(preview?.message || 'Не удалось получить детей из Qosymsha.');
      }

      const items = Array.isArray(preview.items) ? preview.items : [];
      const defaultSelection = Object.fromEntries(items.map((item, idx) => [qosymshaChildKey(item, idx), true]));
      setQosymshaSelectedChildren(defaultSelection);
      setQosymshaPreview(preview);
      setQosymshaSyncLoadingText('');
      setQosymshaSyncProgress(100);
      setQosymshaImportResult(null);
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось получить данные из Qosymsha.');
      setQosymshaSyncProgress(0);
    } finally {
      setQosymshaSyncing(false);
    }
  }

  async function startArtsportPreviewLoad() {
    setArtsportSyncing(true);
    setArtsportSyncLoadingText('Окно Artsport открыто. Войдите в аккаунт...');
    setArtsportSyncProgress(4);
    try {
      const preview = await api.fetchArtsportChildrenPreview();
      if (!preview?.success) {
        throw new Error(preview?.message || 'Не удалось получить детей из Artsport.');
      }

      const items = Array.isArray(preview.items) ? preview.items : [];
      const defaultSelection = Object.fromEntries(items.map((item, idx) => [qosymshaChildKey(item, idx), true]));
      setArtsportSelectedChildren(defaultSelection);
      setArtsportPreview(preview);
      setArtsportSyncLoadingText('');
      setArtsportSyncProgress(100);
      setArtsportImportResult(null);
      setError('');
    } catch (e) {
      setError(e?.message || 'Не удалось получить данные из Artsport.');
      setArtsportSyncProgress(0);
    } finally {
      setArtsportSyncing(false);
    }
  }

  function toggleQosymshaChild(item, index, checked) {
    const key = qosymshaChildKey(item, index);
    setQosymshaSelectedChildren((prev) => ({ ...prev, [key]: checked }));
  }

  function selectAllQosymshaChildren(checked) {
    const items = Array.isArray(qosymshaPreview?.items) ? qosymshaPreview.items : [];
    if (!items.length) return;
    setQosymshaSelectedChildren(
      Object.fromEntries(items.map((item, idx) => [qosymshaChildKey(item, idx), checked]))
    );
  }

  function toggleArtsportChild(item, index, checked) {
    const key = qosymshaChildKey(item, index);
    setArtsportSelectedChildren((prev) => ({ ...prev, [key]: checked }));
  }

  function selectAllArtsportChildren(checked) {
    const items = Array.isArray(artsportPreview?.items) ? artsportPreview.items : [];
    if (!items.length) return;
    setArtsportSelectedChildren(
      Object.fromEntries(items.map((item, idx) => [qosymshaChildKey(item, idx), checked]))
    );
  }

  async function importSelectedQosymshaChildren() {
    const items = Array.isArray(qosymshaPreview?.items) ? qosymshaPreview.items : [];
    const selectedItems = items.filter((item, idx) => !!qosymshaSelectedChildren[qosymshaChildKey(item, idx)]);
    if (!selectedItems.length) {
      setError('Выберите хотя бы одного ребенка из Qosymsha.');
      return;
    }

    setQosymshaSyncing(true);
    setQosymshaSyncLoadingText('Импортируем выбранных детей в базу...');
    setQosymshaSyncProgress(100);
    try {
      const result = await api.syncQosymshaVouchers({
        fetched: Number(qosymshaPreview?.fetched || selectedItems.length),
        items: selectedItems
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Не удалось синхронизировать данные из Qosymsha.');
      }

      if (Number(result.added || 0) + Number(result.updated || 0) === 0 && Number(result.skipped || 0) > 0) {
        const firstError = Array.isArray(result.errors) && result.errors.length ? `\n${result.errors[0]}` : '';
        throw new Error(`Не удалось импортировать детей из Qosymsha.${firstError}`);
      }

      await loadChildren();
      await loadChildrenCounts();
      setActiveList('voucher');
      setCityFilter('');
      setStudioFilter('');
      setCourseFilter('');
      setMessageTagFilter('');
      setSearch('');
      setError('');
      setQosymshaImportResult({
        selected: selectedItems.length,
        fetched: Number(result.fetched || 0),
        added: Number(result.added || 0),
        updated: Number(result.updated || 0),
        skipped: Number(result.skipped || 0),
        newChildren: Array.isArray(result.newChildren) ? result.newChildren.slice(0, 50) : [],
        errors: Array.isArray(result.errors) ? result.errors.slice(0, 10) : []
      });
    } catch (e) {
      setError(e?.message || 'Синхронизация с Qosymsha не удалась.');
    } finally {
      setQosymshaSyncing(false);
      setQosymshaSyncLoadingText('');
    }
  }

  async function importSelectedArtsportChildren() {
    const items = Array.isArray(artsportPreview?.items) ? artsportPreview.items : [];
    const selectedItems = items.filter((item, idx) => !!artsportSelectedChildren[qosymshaChildKey(item, idx)]);
    if (!selectedItems.length) {
      setError('Выберите хотя бы одного ребенка из Artsport.');
      return;
    }

    setArtsportSyncing(true);
    setArtsportSyncLoadingText('Импортируем выбранных детей в базу...');
    setArtsportSyncProgress(100);
    try {
      const result = await api.syncArtsportVouchers({
        fetched: Number(artsportPreview?.fetched || selectedItems.length),
        items: selectedItems
      });

      if (!result?.success) {
        throw new Error(result?.message || 'Не удалось синхронизировать данные из Artsport.');
      }
      if (Number(result.added || 0) + Number(result.updated || 0) === 0 && Number(result.skipped || 0) > 0) {
        const firstError = Array.isArray(result.errors) && result.errors.length ? `\n${result.errors[0]}` : '';
        throw new Error(`Не удалось импортировать детей из Artsport.${firstError}`);
      }

      await loadChildren();
      await loadChildrenCounts();
      setActiveList('voucher');
      setCityFilter('');
      setStudioFilter('');
      setCourseFilter('');
      setMessageTagFilter('');
      setSearch('');
      setError('');
      setArtsportImportResult({
        selected: selectedItems.length,
        fetched: Number(result.fetched || 0),
        added: Number(result.added || 0),
        updated: Number(result.updated || 0),
        skipped: Number(result.skipped || 0),
        newChildren: Array.isArray(result.newChildren) ? result.newChildren.slice(0, 50) : [],
        errors: Array.isArray(result.errors) ? result.errors.slice(0, 10) : []
      });
    } catch (e) {
      setError(e?.message || 'Синхронизация с Artsport не удалась.');
    } finally {
      setArtsportSyncing(false);
      setArtsportSyncLoadingText('');
    }
  }

  function exportReport(format) {
    const fields = getReportFieldsByList(activeList);
    const selected = fields.filter((f) => reportSelected.includes(f.key));
    const header = selected.map((f) => f.label);
    const sourceRows = activeList === 'queue' ? sortedQueueRows : activeList === 'archived' ? filteredArchivedRows : sortedRows;
    const rows = sourceRows.map((row) => selected.map((f) => getReportValue(row, f.key)));

    if (format === 'xlsx') {
      import('xlsx').then((XLSX) => {
        const data = rows.map((row) => Object.fromEntries(row.map((v, idx) => [header[idx], v])));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Отчет');
        const suffix = activeList === 'queue' ? 'queue' : activeList;
        XLSX.writeFile(wb, `children-report-${suffix}.xlsx`);
      });
      return;
    }

    const html = `
      <html><head><meta charset="utf-8" /><title>Children Report</title>
      <style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:6px;font-size:12px;text-align:left}</style>
      </head><body>
      <h3>Отчет по детям</h3>
      <table><thead><tr>${header.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${String(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>
      </body></html>
    `;
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  const queueBirthDate = parseBirthDateFromIIN(queueModalData?.childIIN);
  const queueAge = ageFromBirthDate(queueBirthDate);
  const transferBirthDate = parseBirthDateFromIIN(queueToVoucherData?.childIIN);
  const transferAge = ageFromBirthDate(transferBirthDate);
  const transferCourses = useMemo(
    () => courses.filter((c) => Number(c.studioId) === Number(queueToVoucherData?.studioId || 0)),
    [courses, queueToVoucherData?.studioId]
  );
  const transferGroups = useMemo(
    () => groups.filter((g) => Number(g.courseId) === Number(queueToVoucherData?.courseId || 0)),
    [groups, queueToVoucherData?.courseId]
  );
  const activeListLabel = activeList === 'queue' ? 'Очередь' : activeList === 'voucher' ? 'Ваучеры' : activeList === 'archived' ? 'Архив' : 'Платники';

  function openQueueTransfer(row) {
    const isVoucher = String(row.queueNumber || '').trim().toUpperCase() === 'ВАУЧЕР';
    if (!isVoucher) return;
    setQueueToVoucherData({
      queueId: row.id,
      cityId: row.cityId || cityFilter || '',
      studioId: row.studioId || studioFilter || '',
      courseId: '',
      groupId: '',
      childFullName: row.childFullName || '',
      childIIN: row.childIIN || '',
      parentPhone: row.phone || '',
      parentFullName: row.parentFullName || '',
      parentIIN: row.parentIIN || '',
      parentEmail: '',
      enrollmentDate: todayIso(),
      voucherNumber: '',
      voucherEndDate: '',
      sourceQueueNumber: String(row.queueNumber || '')
    });
  }

  function downloadImportTemplate() {
    const type = activeList;
    const baseRows = [];
    let headers = [];
    if (type === 'paid') {
      headers = [
        'Город', 'Студия', 'Кружок', 'Группа',
        'ФИО ребенка', 'ИИН ребенка', 'Дата рождения', 'Возраст',
        'Телефон родителя', 'ФИО родителя', 'Дата зачисления',
        'Старт оплаты', 'Дата последней оплаты'
      ];
      baseRows.push({
        'Город': 'Астана',
        'Студия': studios[0]?.name || '',
        'Кружок': courses[0]?.name || '',
        'Группа': '',
        'ФИО ребенка': '',
        'ИИН ребенка': '',
        'Дата рождения': '',
        'Возраст': '',
        'Телефон родителя': '',
        'ФИО родителя': '',
        'Дата зачисления': todayIso(),
        'Старт оплаты': todayIso(),
        'Дата последней оплаты': ''
      });
    } else if (type === 'voucher') {
      headers = [
        'Город', 'Студия', 'Кружок', 'Группа',
        'ФИО ребенка', 'ИИН ребенка', 'Дата рождения', 'Возраст',
        'Телефон родителя', 'ФИО родителя', 'ИИН родителя', 'Email родителя',
        'Дата зачисления'
      ];
      baseRows.push({
        'Город': 'Астана',
        'Студия': studios[0]?.name || '',
        'Кружок': courses[0]?.name || '',
        'Группа': '',
        'ФИО ребенка': '',
        'ИИН ребенка': '',
        'Дата рождения': '',
        'Возраст': '',
        'Телефон родителя': '',
        'ФИО родителя': '',
        'ИИН родителя': '',
        'Email родителя': '',
        'Дата зачисления': todayIso()
      });
    } else {
      headers = [
        'Город', 'Студия', 'ФИО ребенка', 'ИИН ребенка',
        'ФИО родителя', 'ИИН родителя', 'Телефон',
        'Дата очереди', 'Номер очереди', 'Категория очереди', 'Комментарий'
      ];
      baseRows.push({
        'Город': 'Астана',
        'Студия': studios[0]?.name || '',
        'ФИО ребенка': '',
        'ИИН ребенка': '',
        'ФИО родителя': '',
        'ИИН родителя': '',
        'Телефон': '',
        'Дата очереди': todayIso(),
        'Номер очереди': '',
        'Категория очереди': '',
        'Комментарий': ''
      });
    }

    import('xlsx').then((XLSX) => {
      const ws = XLSX.utils.json_to_sheet(baseRows, { header: headers, skipHeader: false });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeListLabel);
      XLSX.writeFile(wb, `template-${activeList}.xlsx`);
    });
  }

  function resolveStudioId(row) {
    const studioIdNum = Number(row['ID студии'] || row.studioId || 0);
    if (studioIdNum) return studioIdNum;
    const cityName = normalizeText(row['Город'] || row.cityName);
    const studioName = normalizeText(row['Студия'] || row.studioName);
    const city = cities.find((c) => normalizeText(c.name) === cityName);
    const studioCandidates = studios.filter((s) => normalizeText(s.name) === studioName);
    if (city) {
      const byCity = studioCandidates.find((s) => Number(s.cityId) === Number(city.id));
      if (byCity) return byCity.id;
    }
    return studioCandidates[0]?.id || 0;
  }

  function resolveCourseId(row, studioId) {
    const courseIdNum = Number(row['ID кружка'] || row.courseId || 0);
    if (courseIdNum) return courseIdNum;
    const courseName = normalizeText(row['Кружок'] || row.courseName);
    if (!courseName) return 0;
    const list = courses.filter((c) => normalizeText(c.name) === courseName && Number(c.studioId) === Number(studioId));
    return list[0]?.id || 0;
  }

  function resolveGroupId(row, courseId) {
    const groupIdNum = Number(row['ID группы'] || row.groupId || 0);
    if (groupIdNum) return groupIdNum;
    const groupName = normalizeText(row['Группа'] || row.groupName);
    if (!groupName) return null;
    const list = groups.filter((g) => normalizeText(g.name) === groupName && Number(g.courseId) === Number(courseId));
    return list[0]?.id || null;
  }

  async function importRows(rows) {
    const type = activeList;
    let success = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        if (type === 'queue') {
          const cityName = normalizeText(row['Город'] || row.cityName);
          const city = cities.find((c) => normalizeText(c.name) === cityName);
          const studioId = resolveStudioId(row);
          if (!city?.id) throw new Error('Не найден город');
          if (!studioId) throw new Error('Не найдена студия');

          await api.saveQueueChild({
            cityId: city.id,
            studioId,
            childFullName: String(row['ФИО ребенка'] || row.childFullName || '').trim(),
            childIIN: digitsOnly(row['ИИН ребенка'] || row.childIIN),
            parentFullName: String(row['ФИО родителя'] || row.parentFullName || '').trim(),
            parentIIN: digitsOnly(row['ИИН родителя'] || row.parentIIN),
            phone: String(row['Телефон'] || row.phone || '').trim(),
            queueDate: asIsoDate(row['Дата очереди'] || row.queueDate) || todayIso(),
            queueNumber: String(row['Номер очереди'] || row.queueNumber || '').trim(),
            queueCategory: String(row['Категория очереди'] || row.queueCategory || '').trim(),
            comment: String(row['Комментарий'] || row.comment || '').trim()
          });
        } else {
          const studioId = resolveStudioId(row);
          if (!studioId) throw new Error('Не найдена студия');
          const courseId = resolveCourseId(row, studioId);
          if (!courseId) throw new Error('Не найден кружок');
          const groupId = resolveGroupId(row, courseId);

          const childIIN = digitsOnly(row['ИИН ребенка'] || row.childIIN);
          const childBirthDate = asIsoDate(row['Дата рождения'] || row.childBirthDate);
          const ageRaw = String(row['Возраст'] || row.childAge || '').trim();
          const manualAge = ageRaw === '' ? null : Number(ageRaw);
          const enrollmentDate = asIsoDate(row['Дата зачисления'] || row.enrollmentDate) || todayIso();

          const profile = {
            childFullName: String(row['ФИО ребенка'] || row.childFullName || '').trim(),
            childIIN,
            childBirthDate,
            manualAge: Number.isFinite(manualAge) ? manualAge : null,
            parentPhone: String(row['Телефон родителя'] || row.parentPhone || '').trim(),
            parentFullName: String(row['ФИО родителя'] || row.parentFullName || '').trim(),
            enrollmentDate
          };

          if (type === 'paid') {
            profile.paymentStartDate = asIsoDate(row['Старт оплаты'] || row.paymentStartDate) || enrollmentDate;
            profile.lastPaymentDate = asIsoDate(row['Дата последней оплаты'] || row.lastPaymentDate) || '';
            profile.lessonsCount = 0;
          } else {
            profile.parentIIN = digitsOnly(row['ИИН родителя'] || row.parentIIN);
            profile.parentEmail = String(row['Email родителя'] || row.parentEmail || '').trim();
            profile.voucherNumber = String(row['Номер ваучера'] || row.voucherNumber || 'ВАУЧЕР').trim() || 'ВАУЧЕР';
            profile.voucherEndDate = asIsoDate(row['Окончание ваучера'] || row.voucherEndDate) || enrollmentDate;
            profile.importSource = normalizeImportSource(importSource || 'excel');
          }

          await api.saveChild({
            studioId,
            courseId,
            groupId,
            type,
            profile
          });
        }
        success += 1;
      } catch (e) {
        failed += 1;
        errors.push(`Строка ${rowNum}: ${e?.message || 'ошибка импорта'}`);
      }
    }

    setImportResult({ success, failed, errors: errors.slice(0, 10) });
    await loadAll();
    await loadQueueChildren();
    await loadChildrenCounts();
  }

  async function handleImportFile(file) {
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      let rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) {
        setImportResult({ success: 0, failed: 0, errors: ['Файл пустой.'] });
      } else {
        if (activeList === 'queue') {
          const missingInfo = [];
          rows = rows.map((row, idx) => {
            const missing = getQueueRowMissingFields(row);
            if (!missing.length) return row;
            const rowNum = idx + 2;
            missingInfo.push(`Строка ${rowNum}: ${missing.map((x) => x.title).join(', ')}`);
            const fallbackNumber = String(900000 + idx);
            return {
              ...row,
              childFullName: String(row['ФИО ребенка'] || row.childFullName || '').trim() || `Ребенок ${idx + 1}`,
              childIIN: digitsOnly(row['ИИН ребенка'] || row.childIIN) || '000000000000',
              parentFullName: String(row['ФИО родителя'] || row.parentFullName || '').trim() || 'Не указано',
              parentIIN: digitsOnly(row['ИИН родителя'] || row.parentIIN) || '000000000000',
              phone: String(row['Телефон'] || row.phone || '').trim() || '+70000000000',
              queueDate: asIsoDate(row['Дата очереди'] || row.queueDate) || todayIso(),
              queueNumber: String(row['Номер очереди'] || row.queueNumber || '').trim() || fallbackNumber,
              queueCategory: String(row['Категория очереди'] || row.queueCategory || '').trim() || 'Не указано'
            };
          });

          if (missingInfo.length) {
            const preview = missingInfo.slice(0, 12).join('\n');
            const extra = missingInfo.length > 12 ? `\n... и еще ${missingInfo.length - 12} строк.` : '';
            const confirmText =
              `В файле есть неполные данные очереди.\n\n${preview}${extra}\n\n` +
              'Продолжить загрузку с автозаполнением пустых полей значениями по умолчанию?';
            if (!window.confirm(confirmText)) {
              setImportResult({ success: 0, failed: 0, errors: ['Импорт отменен пользователем.'] });
              return;
            }
          }
        }
        await importRows(rows);
      }
    } catch (e) {
      setImportResult({ success: 0, failed: 1, errors: [e?.message || 'Не удалось прочитать Excel.'] });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <section className="children-page">
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}
      <div className="children-sticky-top">
        <div className="children-list-tabs">
          <button className={activeList === 'paid' ? 'tab-active' : ''} onClick={() => setActiveList('paid')}>
            Платники ({childrenCounts.paid})
          </button>
          <button className={activeList === 'voucher' ? 'tab-active' : ''} onClick={() => setActiveList('voucher')}>
            Ваучеры ({childrenCounts.voucher})
          </button>
          <button className={activeList === 'queue' ? 'tab-active' : ''} onClick={() => setActiveList('queue')}>
            Очередь ({queueChildren.length})
          </button>
          <button className={activeList === 'archived' ? 'tab-active' : ''} onClick={() => setActiveList('archived')}>
            Архивированные ({childrenCounts.archived || 0})
          </button>
        </div>

        <div className="toolbar children-toolbar">
          <div className="children-toolbar-left">
            {activeList !== 'queue' && activeList !== 'archived' && <button className="primary" onClick={() => setModalData({})}>Добавить ребенка</button>}
            {activeList === 'queue' && (
              <button
                className="primary"
                onClick={() => setQueueModalData({ cityId: cityFilter || '', studioId: studioFilter || '' })}
              >
                Добавить ребенка
              </button>
            )}
            <select value={cityFilter} onChange={(e) => { setCityFilter(e.target.value); setStudioFilter(''); setCourseFilter(''); }}>
              <option value="">Все города</option>
              {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>

            <select value={studioFilter} onChange={(e) => { setStudioFilter(e.target.value); setCourseFilter(''); }}>
              <option value="">Все студии</option>
              {filteredStudios.map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
            </select>

            {activeList !== 'queue' && activeList !== 'archived' && (
              <select value={courseFilter} onChange={(e) => setCourseFilter(e.target.value)}>
                <option value="">Все кружки</option>
                {filteredCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            )}
            {activeList === 'voucher' && (
              <input
                list="message-tag-filter-options"
                value={messageTagFilter}
                onChange={(e) => setMessageTagFilter(e.target.value)}
                placeholder="Все пометки"
              />
            )}
            {activeList === 'voucher' && (
              <datalist id="message-tag-filter-options">
                <option value="qr" />
                <option value="напоминание" />
              </datalist>
            )}
            {activeList === 'archived' && (
              <select value={archivedCategory} onChange={(e) => setArchivedCategory(e.target.value)}>
                <option value="paid">Платники</option>
                <option value="voucher">Ваучеры</option>
                <option value="queue">Очередь</option>
              </select>
            )}
            <button type="button" onClick={() => setSelectionMode((v) => !v)}>
              {selectionMode ? 'Скрыть выбор' : 'Выбрать'}
            </button>
          </div>

          {selectionMode && (
            <div className="children-selection-bar">
              <div className="children-selection-summary">Выбрано: {selectedRows.length}</div>
              <div className="children-selection-actions">
                <button type="button" onClick={allVisibleSelected ? clearVisibleSelection : selectAllVisible}>
                  {allVisibleSelected ? 'Снять выбор' : 'Выбрать все'}
                </button>
                <button type="button" className="danger" onClick={deleteSelectedRows} disabled={!selectedRows.length}>
                  Удалить
                </button>
                {(activeList === 'voucher' || activeList === 'paid') && (
                  <>
                    <select value={selectedCourseForBulk} onChange={(e) => setSelectedCourseForBulk(e.target.value)}>
                      <option value="">Кружок</option>
                      {selectableVoucherCourses.map((course) => (
                        <option key={course.id} value={course.id}>{course.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={applySelectedCourseToVouchers}
                      disabled={!selectedRows.length || !selectedCourseForBulk}
                    >
                      Назначить
                    </button>
                    <details className="children-actions-menu">
                      <summary>Еще</summary>
                      <div className="children-actions-menu-list">
                        <button type="button" onClick={() => applyVoucherTag('qr')} disabled={!selectedRows.length}>Пометка: QR</button>
                        <button type="button" onClick={() => applyVoucherTag('reminder')} disabled={!selectedRows.length}>Пометка: Напоминание</button>
                        <button
                          type="button"
                          onClick={() => {
                            const customTag = window.prompt('Введите свою пометку');
                            if (customTag === null) return;
                            applyVoucherTag(customTag);
                          }}
                          disabled={!selectedRows.length}
                        >
                          Своя пометка
                        </button>
                        <button type="button" onClick={() => applyVoucherTag('')} disabled={!selectedRows.length}>Убрать пометку</button>
                        <button
                          type="button"
                          onClick={() => {
                            setBulkEditData({ cityId: '', studioId: '', courseId: '', messageTag: '', messageTagMode: '', voucherNumber: '' });
                            setBulkEditOpen(true);
                          }}
                          disabled={!selectedRows.length}
                        >
                          Расширенное изменение
                        </button>
                      </div>
                    </details>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="children-toolbar-right">
            <input
              placeholder="Поиск"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="children-search"
            />
            {activeList === 'queue' && (
              <button
                onClick={async () => {
                  if (!sortedQueueRows.length) return;
                  setQueueRefreshing(true);
                  setQueueRefreshOpen(true);
                  setQueueRefreshResult(null);
                  setQueueRefreshProgress(6);
                  try {
                    const ids = sortedQueueRows.map((x) => x.id);
                    const res = await api.refreshQueueChildren({ ids });
                    setQueueRefreshResult(res || null);
                    await loadQueueChildren();
                    setError('');
                    setQueueRefreshProgress(100);
                    if (res?.failed) {
                      setError(`Обновлено: ${res.updated}, ошибок: ${res.failed}`);
                    }
                  } catch (e) {
                    setError(e?.message || 'Не удалось обновить очередь.');
                  } finally {
                    window.setTimeout(() => setQueueRefreshing(false), 260);
                  }
                }}
                disabled={queueRefreshing || !sortedQueueRows.length}
              >
                {queueRefreshing ? 'Обновление...' : 'Обновить очередь'}
              </button>
            )}
            {activeList !== 'archived' && <button onClick={() => { setImportResult(null); setImportSource('excel'); setImportOpen(true); }}>Импорт</button>}
            {activeList !== 'archived' && <button onClick={() => setReportOpen(true)}>Экспорт</button>}
          </div>
        </div>
      </div>

      <div className="panel children-list-wrap">
        {activeList === 'queue' ? (
          <table className="children-table queue-table">
            <thead>
              <tr>
                {selectionMode && <th>✓</th>}
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('cityName')}>Город {renderSortArrow(queueSort, 'cityName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('studioName')}>Студия {renderSortArrow(queueSort, 'studioName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('childFullName')}>ФИО ребенка {renderSortArrow(queueSort, 'childFullName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('childAge')}>Возраст {renderSortArrow(queueSort, 'childAge')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('phone')}>Номер телефона {renderSortArrow(queueSort, 'phone')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('queueCategory')}>Категория очереди {renderSortArrow(queueSort, 'queueCategory')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('queueDate')}>Дата очереди {renderSortArrow(queueSort, 'queueDate')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleQueueSort('queueNumber')}>Номер очереди {renderSortArrow(queueSort, 'queueNumber')}</button></th>
                <th>Сдвиг</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedQueueRows.map((row) => (
                <tr key={row.id} className="child-row" style={getQueueRowShiftStyle(row.queueShift)} onClick={() => setSelectedQueueChild(row)}>
                  {selectionMode && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!selectedIds[row.id]} onChange={(e) => toggleSelected(row.id, e.target.checked)} />
                    </td>
                  )}
                  <td>{row.cityName || '—'}</td>
                  <td>{row.studioName || '—'}</td>
                  <td>{row.childFullName}</td>
                  <td>{row.childAge ?? '—'}</td>
                  <td>{row.phone}</td>
                  <td>{row.queueCategory || '—'}</td>
                  <td>{row.queueDate || '—'}</td>
                  <td>{formatQueueNumber(row.queueNumber)}</td>
                  <td>{renderQueueShiftBadge(row.queueShift)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="icon-actions">
                      {String(row.queueNumber || '').trim().toUpperCase() === 'ВАУЧЕР' && (
                        <button className="icon-btn convert" title="Перевести в ваучеры" onClick={() => openQueueTransfer(row)}>⇄</button>
                      )}
                      <button className="icon-btn" title="Редактировать" onClick={() => setQueueModalData(row)}>⋯</button>
                      <button
                        className="icon-btn danger"
                        title="Удалить"
                        onClick={async () => {
                          if (!window.confirm('Удалить ребенка из очереди?')) return;
                          try {
                            await api.deleteQueueChild(row.id);
                            if (selectedQueueChild?.id === row.id) setSelectedQueueChild(null);
                            await loadQueueChildren();
                            await loadArchivedEntities();
                            await loadChildrenCounts();
                          } catch (e) {
                            setError(e?.message || 'Не удалось удалить запись очереди.');
                          }
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!sortedQueueRows.length && (
                <tr><td colSpan={selectionMode ? 11 : 10}>Нет данных</td></tr>
              )}
            </tbody>
          </table>
        ) : activeList === 'archived' ? (
          <table className="children-table">
            <thead>
              <tr>
                {selectionMode && <th>✓</th>}
                <th>Категория</th>
                <th>ФИО ребенка</th>
                <th>Телефон</th>
                <th>Номер/ваучер</th>
                <th>Дата удаления</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredArchivedRows.map((row) => (
                <tr key={row.id} className="child-row" onClick={() => setSelectedArchivedEntity(row)}>
                  {selectionMode && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!selectedIds[row.id]} onChange={(e) => toggleSelected(row.id, e.target.checked)} />
                    </td>
                  )}
                  <td>{row.entityCategory === 'paid' ? 'Платник' : row.entityCategory === 'voucher' ? 'Ваучер' : 'Очередь'}</td>
                  <td>{row.entityName}</td>
                  <td>{row.snapshot?.parentPhone || row.snapshot?.phone || '—'}</td>
                  <td>{row.snapshot?.voucherNumber || formatQueueNumber(row.snapshot?.queueNumber) || '—'}</td>
                  <td>{row.deletedAt || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="icon-btn convert"
                      title="Вернуть из архива"
                      onClick={async () => {
                        try {
                          const res = await api.restoreArchivedEntity({ id: row.id });
                          if (res?.success) {
                            setSelectedArchivedEntity(null);
                            await loadChildren();
                            await loadQueueChildren();
                            await loadArchivedEntities();
                            await loadChildrenCounts();
                          }
                        } catch (e) {
                          setError(e?.message || 'Не удалось восстановить запись из архива.');
                        }
                      }}
                    >
                      ↺
                    </button>
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Удалить из архива навсегда"
                      onClick={async () => {
                        if (!window.confirm('Удалить запись из архива навсегда?')) return;
                        try {
                          await api.deleteArchivedEntity({ id: row.id });
                          await loadArchivedEntities();
                          await loadChildrenCounts();
                        } catch (e) {
                          setError(e?.message || 'Не удалось удалить архивную запись.');
                        }
                      }}
                    >
                      🗑
                    </button>
                  </td>
                </tr>
              ))}
              {!filteredArchivedRows.length && (
                <tr><td colSpan={selectionMode ? 7 : 6}>Нет данных</td></tr>
              )}
            </tbody>
          </table>
        ) : (
          <table className="children-table">
            <thead>
              <tr>
                {selectionMode && <th>✓</th>}
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('cityName')}>Город {renderSortArrow(childrenSort, 'cityName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('studioName')}>Студия {renderSortArrow(childrenSort, 'studioName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('childName')}>ФИО ребенка {renderSortArrow(childrenSort, 'childName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('childAge')}>Возраст {renderSortArrow(childrenSort, 'childAge')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('courseName')}>Кружок {renderSortArrow(childrenSort, 'courseName')}</button></th>
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('groupName')}>Группа {renderSortArrow(childrenSort, 'groupName')}</button></th>
                {activeList === 'paid' && <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('lastPaymentDate')}>Дата последней оплаты {renderSortArrow(childrenSort, 'lastPaymentDate')}</button></th>}
                <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('parentPhone')}>Номер телефона {renderSortArrow(childrenSort, 'parentPhone')}</button></th>
                {activeList === 'voucher' && <th><button type="button" className="th-sort-btn" onClick={() => toggleChildrenSort('messageTag')}>Пометка {renderSortArrow(childrenSort, 'messageTag')}</button></th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="child-row" onClick={() => openProfile(row)}>
                  {selectionMode && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={!!selectedIds[row.id]} onChange={(e) => toggleSelected(row.id, e.target.checked)} />
                    </td>
                  )}
                  <td>{row.cityName}</td>
                  <td>{row.studioName}</td>
                  <td>
                    <div className="child-name-with-source">
                      <span>{row.childName}</span>
                      {activeList === 'voucher' && getImportSourceMeta(row.importSource) && (
                        <span className="import-source-chip">
                          {getImportSourceMeta(row.importSource)?.logo ? (
                            <img src={getImportSourceMeta(row.importSource).logo} alt={getImportSourceMeta(row.importSource).label} />
                          ) : null}
                          <span>{getImportSourceMeta(row.importSource).label}</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td>{row.childAge}</td>
                  <td>{row.courseName}</td>
                  <td>{row.groupName || '—'}</td>
                  {activeList === 'paid' && <td>{row.lastPaymentDate || '—'}</td>}
                  <td>{row.parentPhone}</td>
                  {activeList === 'voucher' && (
                    <td>
                      {row.messageTag ? <span className={`tag-chip ${row.messageTag}`}>{messageTagLabel(row.messageTag)}</span> : '—'}
                    </td>
                  )}
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="icon-actions">
                      <button className="icon-btn" title="Редактировать" onClick={() => openEdit(row.id)}>⋯</button>
                      <button
                        className="icon-btn danger"
                        title="Удалить"
                        onClick={async () => {
                          if (!window.confirm('Удалить ребенка?')) return;
                          try {
                            await api.deleteChild(row.id);
                            await loadChildren();
                            await loadArchivedEntities();
                            await loadChildrenCounts();
                          } catch (e) {
                            setError(e?.message || 'Не удалось удалить ребенка.');
                          }
                        }}
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!sortedRows.length && (
                <tr><td colSpan={selectionMode ? (activeList === 'paid' ? 10 : 10) : (activeList === 'paid' ? 9 : 9)}>Нет данных</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="children-summary">
        Итого в списке: {activeList === 'queue' ? sortedQueueRows.length : activeList === 'archived' ? filteredArchivedRows.length : sortedRows.length}
      </div>

      {selectedChild && (
        <Modal title="Карточка ребенка" onClose={() => setSelectedChild(null)}>
          <div className={`child-sheet ${selectedChild.type === 'paid' ? 'paid' : 'voucher'}`}>
            <div className="child-sheet-head">
              <div className="child-sheet-name">{selectedChild.profile?.childFullName || '—'}</div>
              <span className={`child-sheet-type ${selectedChild.type === 'paid' ? 'paid' : 'voucher'}`}>
                {selectedChild.type === 'paid' ? 'Платно' : 'Ваучер'}
              </span>
            </div>
            <div className="child-sheet-grid">
              <div className="child-sheet-row"><span>Город</span><b>{selectedChild._meta?.cityName || '—'}</b></div>
              <div className="child-sheet-row"><span>Студия</span><b>{selectedChild._meta?.studioName || '—'}</b></div>
              <div className="child-sheet-row"><span>Кружок</span><b>{selectedChild._meta?.courseName || '—'}</b></div>
              <div className="child-sheet-row"><span>Группа</span><b>{selectedChild._meta?.groupName || '—'}</b></div>
              <div className="child-sheet-row"><span>ИИН ребенка</span><b>{selectedChild.profile?.childIIN || '—'}</b></div>
              <div className="child-sheet-row"><span>Дата рождения</span><b>{selectedChild.profile?.childBirthDate || '—'}</b></div>
              <div className="child-sheet-row"><span>Возраст</span><b>{selectedChild.profile?.childAge ?? '—'}</b></div>
              <div className="child-sheet-row"><span>Телефон родителя</span><b>{selectedChild.profile?.parentPhone || '—'}</b></div>
              <div className="child-sheet-row"><span>ФИО родителя</span><b>{selectedChild.profile?.parentFullName || '—'}</b></div>
              {selectedChild.type === 'voucher' && <div className="child-sheet-row"><span>Пометка</span><b>{messageTagLabel(selectedChild.messageTag)}</b></div>}
              <div className="child-sheet-row"><span>Дата зачисления</span><b>{selectedChild.profile?.enrollmentDate || '—'}</b></div>
            </div>
            {selectedChild.type === 'paid' && (
              <div className="child-sheet-grid" style={{ marginTop: 10 }}>
                <div className="child-sheet-row"><span>Старт оплаты</span><b>{selectedChild.profile?.paymentStartDate || '—'}</b></div>
                <div className="child-sheet-row"><span>Последняя оплата</span><b>{selectedChild.profile?.lastPaymentDate || '—'}</b></div>
                <div className="child-sheet-row"><span>Уроков после оплаты</span><b>{selectedChild.profile?.lessonsCount ?? '—'}</b></div>
                <div className="child-sheet-row"><span>Текущий цикл</span><b>{selectedChild.profile?.lessonsCount ?? 0}/{selectedChild.profile?.cycleLength || selectedChild._meta?.cycleLength || 8}</b></div>
              </div>
            )}
            {selectedChild.type === 'voucher' && (
              <div className="child-sheet-grid" style={{ marginTop: 10 }}>
                <div className="child-sheet-row">
                  <span>Источник импорта</span>
                  <b>
                    {(() => {
                      const sourceMeta = getImportSourceMeta(selectedChild._meta?.importSource || selectedChild.profile?.importSource);
                      if (!sourceMeta) return '—';
                      return (
                        <span className="import-source-chip inline">
                          {sourceMeta.logo ? <img src={sourceMeta.logo} alt={sourceMeta.label} /> : null}
                          <span>{sourceMeta.label}</span>
                        </span>
                      );
                    })()}
                  </b>
                </div>
                <div className="child-sheet-row"><span>ИИН родителя</span><b>{selectedChild.profile?.parentIIN || '—'}</b></div>
                <div className="child-sheet-row"><span>Email родителя</span><b>{selectedChild.profile?.parentEmail || '—'}</b></div>
                <label className="child-sheet-row full">
                  <span>Редактировать пометку</span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <select
                      value={getMessageTagPreset(selectedChildTagDraft)}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSelectedChildTagDraft((prev) => {
                          if (next === 'custom') return getMessageTagPreset(prev) === 'custom' ? prev : '';
                          return next;
                        });
                      }}
                      style={{ minWidth: 180 }}
                    >
                      <option value="">Без пометки</option>
                      <option value="qr">QR</option>
                      <option value="reminder">Напоминание</option>
                      <option value="custom">Своя пометка</option>
                    </select>
                    <input
                      value={getMessageTagPreset(selectedChildTagDraft) === 'custom' ? selectedChildTagDraft : ''}
                      onChange={(e) => setSelectedChildTagDraft(e.target.value)}
                      placeholder="Своя пометка"
                      style={{ minWidth: 220 }}
                      disabled={getMessageTagPreset(selectedChildTagDraft) !== 'custom'}
                    />
                    <button
                      type="button"
                      onClick={saveSelectedChildTag}
                      disabled={selectedChildTagSaving}
                    >
                      {selectedChildTagSaving ? 'Сохранение...' : 'Сохранить пометку'}
                    </button>
                  </div>
                </label>
              </div>
            )}
            {selectedChild.type === 'paid' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button type="button" className="primary" onClick={() => openTransferModal(selectedChild)}>
                  Перевести в другую группу
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {transferModalData && selectedChild?.type === 'paid' && (
        <Modal title="Перевод в другую группу" onClose={() => !transferSaving && setTransferModalData(null)}>
          <div className="form-grid">
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Студия</div>
              <select
                value={transferModalData.studioId}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, studioId: e.target.value, courseId: '', groupId: '' }))}
                disabled={transferSaving}
              >
                <option value="">Выберите...</option>
                {transferStudios.map((studio) => (
                  <option key={studio.id} value={studio.id}>{studio.name}</option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Кружок</div>
              <select
                value={transferModalData.courseId}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, courseId: e.target.value, groupId: '' }))}
                disabled={transferSaving || !transferModalData.studioId}
              >
                <option value="">Выберите...</option>
                {paidTransferCourses.map((course) => (
                  <option key={course.id} value={course.id}>{course.name}</option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Группа</div>
              <select
                value={transferModalData.groupId}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, groupId: e.target.value }))}
                disabled={transferSaving || !transferModalData.courseId}
              >
                <option value="">Выберите...</option>
                {transferGroupsOptions.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата перевода</div>
              <input
                type="date"
                value={transferModalData.effectiveDate}
                onChange={(e) => setTransferModalData((prev) => ({ ...prev, effectiveDate: e.target.value }))}
                disabled={transferSaving}
              />
            </label>
          </div>
          <div style={{ marginTop: 12, color: '#97a7c3' }}>
            История старой группы сохранится. С указанной даты ребенок будет отмечаться уже в новой группе.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button type="button" onClick={() => setTransferModalData(null)} disabled={transferSaving}>Отмена</button>
            <button type="button" className="primary" onClick={submitTransferChild} disabled={transferSaving}>
              {transferSaving ? 'Переводим...' : 'Сохранить перевод'}
            </button>
          </div>
        </Modal>
      )}

      {selectedQueueChild && (
        <Modal title="Карточка очередника" onClose={() => setSelectedQueueChild(null)}>
          <div className="child-sheet queue">
            <div className="child-sheet-head">
              <div className="child-sheet-name">{selectedQueueChild.childFullName}</div>
              <span className="child-sheet-type queue">Очередь</span>
            </div>
            <div className="child-sheet-grid">
              <div className="child-sheet-row"><span>Возраст</span><b>{selectedQueueChild.childAge ?? '—'}</b></div>
              <div className="child-sheet-row"><span>ИИН ребенка</span><b>{selectedQueueChild.childIIN}</b></div>
              <div className="child-sheet-row"><span>Дата рождения</span><b>{selectedQueueChild.childBirthDate || '—'}</b></div>
              <div className="child-sheet-row"><span>ФИО родителя</span><b>{selectedQueueChild.parentFullName}</b></div>
              <div className="child-sheet-row"><span>ИИН родителя</span><b>{selectedQueueChild.parentIIN}</b></div>
              <div className="child-sheet-row"><span>Телефон</span><b>{selectedQueueChild.phone}</b></div>
              <div className="child-sheet-row"><span>Город</span><b>{selectedQueueChild.cityName || '—'}</b></div>
              <div className="child-sheet-row"><span>Студия</span><b>{selectedQueueChild.studioName || '—'}</b></div>
              <div className="child-sheet-row"><span>Номер очереди</span><b>{formatQueueNumber(selectedQueueChild.queueNumber)}</b></div>
              <div className="child-sheet-row"><span>Было / Стало</span><b>{formatQueueNumber(selectedQueueChild.previousQueueNumber)} / {formatQueueNumber(selectedQueueChild.queueNumber)}</b></div>
              <div className="child-sheet-row"><span>Сдвиг</span><b>{renderQueueShiftBadge(selectedQueueChild.queueShift)}</b></div>
              <div className="child-sheet-row"><span>Последнее обновление очереди</span><b>{formatQueueUpdatedAt(selectedQueueChild.queueUpdatedAt)}</b></div>
              <div className="child-sheet-row"><span>Дата постановки</span><b>{selectedQueueChild.queueDate}</b></div>
              <div className="child-sheet-row"><span>Категория очереди</span><b>{selectedQueueChild.queueCategory}</b></div>
              <div className="child-sheet-row full"><span>Комментарий</span><b>{selectedQueueChild.comment || '—'}</b></div>
            </div>
          </div>
        </Modal>
      )}

      {selectedArchivedEntity && (
        <Modal title="Архивная карточка" onClose={() => setSelectedArchivedEntity(null)}>
          <div className={`child-sheet ${selectedArchivedEntity.entityCategory === 'paid' ? 'paid' : selectedArchivedEntity.entityCategory === 'voucher' ? 'voucher' : 'queue'}`}>
            <div className="child-sheet-head">
              <div className="child-sheet-name">{selectedArchivedEntity.entityName}</div>
              <span className={`child-sheet-type ${selectedArchivedEntity.entityCategory === 'paid' ? 'paid' : selectedArchivedEntity.entityCategory === 'voucher' ? 'voucher' : 'queue'}`}>
                {selectedArchivedEntity.entityCategory === 'paid' ? 'Платно' : selectedArchivedEntity.entityCategory === 'voucher' ? 'Ваучер' : 'Очередь'}
              </span>
            </div>
            <div className="child-sheet-grid">
              <div className="child-sheet-row"><span>Город</span><b>{resolveEntityName(cities, selectedArchivedEntity.snapshot?.cityId)}</b></div>
              <div className="child-sheet-row"><span>Студия</span><b>{resolveEntityName(studios, selectedArchivedEntity.snapshot?.studioId)}</b></div>
              <div className="child-sheet-row"><span>Кружок</span><b>{resolveEntityName(courses, selectedArchivedEntity.snapshot?.courseId)}</b></div>
              <div className="child-sheet-row"><span>Группа</span><b>{resolveEntityName(groups, selectedArchivedEntity.snapshot?.groupId)}</b></div>
              <div className="child-sheet-row"><span>ИИН ребенка</span><b>{selectedArchivedEntity.snapshot?.childIIN || '—'}</b></div>
              <div className="child-sheet-row"><span>Телефон</span><b>{selectedArchivedEntity.snapshot?.parentPhone || selectedArchivedEntity.snapshot?.phone || '—'}</b></div>
              <div className="child-sheet-row"><span>ФИО родителя</span><b>{selectedArchivedEntity.snapshot?.parentFullName || '—'}</b></div>
              <div className="child-sheet-row"><span>ИИН родителя</span><b>{selectedArchivedEntity.snapshot?.parentIIN || '—'}</b></div>
              <div className="child-sheet-row"><span>Пометка</span><b>{messageTagLabel(selectedArchivedEntity.snapshot?.messageTag)}</b></div>
              <div className="child-sheet-row"><span>Ваучер/очередь</span><b>{selectedArchivedEntity.snapshot?.voucherNumber || formatQueueNumber(selectedArchivedEntity.snapshot?.queueNumber) || '—'}</b></div>
              <div className="child-sheet-row"><span>Дата удаления</span><b>{selectedArchivedEntity.deletedAt || '—'}</b></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  try {
                    const res = await api.restoreArchivedEntity({ id: selectedArchivedEntity.id });
                    if (res?.success) {
                      setSelectedArchivedEntity(null);
                      await loadChildren();
                      await loadQueueChildren();
                      await loadArchivedEntities();
                      await loadChildrenCounts();
                    }
                  } catch (e) {
                    setError(e?.message || 'Не удалось восстановить запись из архива.');
                  }
                }}
              >
                Вернуть из архива
              </button>
            </div>
          </div>
        </Modal>
      )}

      {queueModalData && (
        <Modal title={queueModalData.id ? 'Редактирование очередника' : 'Добавление очередника'} onClose={() => setQueueModalData(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.saveQueueChild(queueModalData);
                setQueueModalData(null);
                await loadQueueChildren();
                setError('');
              } catch (err) {
                setError(err?.message || 'Не удалось сохранить очередника.');
              }
            }}
          >
            <div className="form-grid">
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Город</div>
                <select
                  value={queueModalData.cityId || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, cityId: e.target.value, studioId: '' }))}
                  required
                >
                  <option value="">Выберите город</option>
                  {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Студия</div>
                <select
                  value={queueModalData.studioId || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, studioId: e.target.value }))}
                  required
                >
                  <option value="">Выберите студию</option>
                  {studios
                    .filter((s) => !queueModalData.cityId || Number(s.cityId) === Number(queueModalData.cityId))
                    .map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
                </select>
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО ребенка</div>
                <input
                  value={queueModalData.childFullName || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, childFullName: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН ребенка</div>
                <input
                  value={queueModalData.childIIN || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, childIIN: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата рождения (из ИИН ребенка)</div>
                <input value={queueBirthDate || '—'} readOnly />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Возраст (из ИИН ребенка)</div>
                <input value={queueAge || '—'} readOnly />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО родителя</div>
                <input
                  value={queueModalData.parentFullName || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, parentFullName: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН родителя</div>
                <input
                  value={queueModalData.parentIIN || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, parentIIN: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Телефон</div>
                <input
                  value={queueModalData.phone || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, phone: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата постановки</div>
                <input
                  type="date"
                  value={queueModalData.queueDate || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, queueDate: e.target.value }))}
                  required={String(queueModalData.queueNumber || '').trim().toUpperCase() !== 'ВАУЧЕР'}
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Номер очереди</div>
                <input
                  type="text"
                  value={queueModalData.queueNumber || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, queueNumber: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Категория очереди</div>
                <input
                  value={queueModalData.queueCategory || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, queueCategory: e.target.value }))}
                  required={String(queueModalData.queueNumber || '').trim().toUpperCase() !== 'ВАУЧЕР'}
                />
              </label>
              <label className="full">
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Комментарий</div>
                <textarea
                  rows={3}
                  value={queueModalData.comment || ''}
                  onChange={(e) => setQueueModalData((v) => ({ ...v, comment: e.target.value }))}
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setQueueModalData(null)}>Отмена</button>
              <button className="primary" type="submit">Сохранить</button>
            </div>
          </form>
        </Modal>
      )}

      {queueToVoucherData && (
        <Modal title="Перевод из очереди в ваучеры" onClose={() => setQueueToVoucherData(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.saveChild({
                  studioId: Number(queueToVoucherData.studioId),
                  courseId: Number(queueToVoucherData.courseId),
                  groupId: queueToVoucherData.groupId ? Number(queueToVoucherData.groupId) : null,
                  type: 'voucher',
                  profile: {
                    childFullName: queueToVoucherData.childFullName,
                    childIIN: queueToVoucherData.childIIN,
                    childBirthDate: transferBirthDate || '',
                    manualAge: null,
                    parentPhone: queueToVoucherData.parentPhone,
                    parentFullName: queueToVoucherData.parentFullName,
                    parentIIN: queueToVoucherData.parentIIN,
                    parentEmail: queueToVoucherData.parentEmail || '',
                    enrollmentDate: queueToVoucherData.enrollmentDate,
                    voucherNumber: queueToVoucherData.sourceQueueNumber || 'ВАУЧЕР',
                    voucherEndDate: queueToVoucherData.enrollmentDate
                  }
                });
                await api.deleteQueueChild(queueToVoucherData.queueId);
                setQueueToVoucherData(null);
                await loadAll();
                await loadQueueChildren();
                setActiveList('voucher');
                setError('');
              } catch (e1) {
                setError(e1?.message || 'Не удалось перевести ребенка в ваучеры.');
              }
            }}
          >
            <div className="form-grid">
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Студия</div>
                <select
                  value={queueToVoucherData.studioId || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, studioId: e.target.value, courseId: '', groupId: '' }))}
                  required
                >
                  <option value="">Выберите студию</option>
                  {studios
                    .filter((s) => !queueToVoucherData.cityId || Number(s.cityId) === Number(queueToVoucherData.cityId))
                    .map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
                </select>
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Кружок</div>
                <select
                  value={queueToVoucherData.courseId || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, courseId: e.target.value, groupId: '' }))}
                  required
                >
                  <option value="">Выберите кружок</option>
                  {transferCourses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
                </select>
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Группа</div>
                <select
                  value={queueToVoucherData.groupId || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, groupId: e.target.value }))}
                >
                  <option value="">Без группы</option>
                  {transferGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО ребенка</div>
                <input
                  value={queueToVoucherData.childFullName || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, childFullName: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН ребенка</div>
                <input
                  value={queueToVoucherData.childIIN || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, childIIN: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата рождения (из ИИН)</div>
                <input value={transferBirthDate || '—'} readOnly />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Возраст (из ИИН)</div>
                <input value={transferAge || '—'} readOnly />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Телефон родителя</div>
                <input
                  value={queueToVoucherData.parentPhone || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, parentPhone: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО родителя</div>
                <input
                  value={queueToVoucherData.parentFullName || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, parentFullName: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН родителя</div>
                <input
                  value={queueToVoucherData.parentIIN || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, parentIIN: e.target.value }))}
                  required
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Email родителя</div>
                <input
                  value={queueToVoucherData.parentEmail || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, parentEmail: e.target.value }))}
                />
              </label>
              <label>
                <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата зачисления</div>
                <input
                  type="date"
                  value={queueToVoucherData.enrollmentDate || ''}
                  onChange={(e) => setQueueToVoucherData((v) => ({ ...v, enrollmentDate: e.target.value }))}
                  required
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14 }}>
              <div style={{ color: '#97a7c3', fontSize: 13 }}>
                Очередь: {formatQueueNumber(queueToVoucherData.sourceQueueNumber)}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setQueueToVoucherData(null)}>Отмена</button>
                <button className="primary" type="submit">Перевести в ваучеры</button>
              </div>
            </div>
          </form>
        </Modal>
      )}

      {modalData && (
        <ChildModal
          data={modalData}
          studios={studios}
          courses={courses}
          groups={groups}
          onClose={() => setModalData(null)}
          onSubmit={async (payload) => {
            try {
              await api.saveChild(payload);
              setModalData(null);
              await loadAll();
              setError('');
            } catch (e) {
              setError(e?.message || 'Не удалось сохранить ребенка.');
            }
          }}
        />
      )}

      {reportOpen && (
        <Modal title="Экспорт данных" onClose={() => setReportOpen(false)}>
          <div className="form-grid">
            {getReportFieldsByList(activeList).map((f) => (
              <label key={f.key}>
                <input
                  type="checkbox"
                  checked={reportSelected.includes(f.key)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setReportSelected((prev) => [...prev, f.key]);
                    } else {
                      setReportSelected((prev) => prev.filter((x) => x !== f.key));
                    }
                  }}
                />{' '}
                {f.label}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={() => exportReport('xlsx')}>Excel</button>
            <button className="primary" onClick={() => exportReport('pdf')}>PDF</button>
          </div>
        </Modal>
      )}

      {importOpen && (
        <Modal title={`Импорт: ${activeListLabel}`} onClose={() => setImportOpen(false)}>
          {activeList === 'voucher' && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                type="button"
                className={importSource === 'excel' ? 'primary' : ''}
                onClick={() => setImportSource('excel')}
              >
                Excel
              </button>
              <button
                type="button"
                className={importSource === 'damubala' ? 'primary' : ''}
                onClick={() => setImportSource('damubala')}
              >
                <span className="import-source-btn-content"><img src={damubalaLogo} alt="Damubala" />Damubala</span>
              </button>
              <button
                type="button"
                className={importSource === 'qosymsha' ? 'primary' : ''}
                onClick={() => setImportSource('qosymsha')}
              >
                <span className="import-source-btn-content"><img src={qosymshaLogo} alt="Qosymsha" />Qosymsha</span>
              </button>
              <button
                type="button"
                className={importSource === 'artsport' ? 'primary' : ''}
                onClick={() => setImportSource('artsport')}
              >
                <span className="import-source-btn-content"><img src={artsportLogo} alt="Artsport" />Artsport</span>
              </button>
            </div>
          )}

          {activeList === 'voucher' && importSource === 'damubala' ? (
            <div>
              <div style={{ marginTop: 6, color: '#97a7c3', fontSize: 13 }}>
                Импорт детей из Damubala по выбранным заявкам. Город, студия и кружок будут созданы автоматически из данных заявки.
              </div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => {
                    setImportOpen(false);
                    openDamubalaSyncModal();
                  }}
                  disabled={damubalaSyncing}
                >
                  {damubalaSyncing ? 'Подключение...' : 'Импортировать из Damubala'}
                </button>
              </div>
            </div>
          ) : activeList === 'voucher' && importSource === 'qosymsha' ? (
            <div>
              <div style={{ marginTop: 6, color: '#97a7c3', fontSize: 13 }}>
                Импорт детей из Qosymsha по карточкам ребенка и законного представителя.
              </div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => {
                    setImportOpen(false);
                    openQosymshaSyncModal();
                  }}
                  disabled={qosymshaSyncing}
                >
                  {qosymshaSyncing ? 'Подключение...' : 'Импортировать из Qosymsha'}
                </button>
              </div>
            </div>
          ) : activeList === 'voucher' && importSource === 'artsport' ? (
            <div>
              <div style={{ marginTop: 6, color: '#97a7c3', fontSize: 13 }}>
                Импорт детей из Artsport. Загружаются только ваучеры со статусом «активирован».
              </div>
              <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  className="primary"
                  type="button"
                  onClick={() => {
                    setImportOpen(false);
                    openArtsportSyncModal();
                  }}
                  disabled={artsportSyncing}
                >
                  {artsportSyncing ? 'Подключение...' : 'Импортировать из Artsport'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="import-actions">
                <button onClick={downloadImportTemplate} disabled={importing}>Скачать шаблон</button>
                <button className="primary" onClick={() => importInputRef.current?.click()} disabled={importing}>
                  {importing ? 'Импорт...' : 'Загрузить Excel'}
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImportFile(e.target.files?.[0])}
                />
              </div>
              <div style={{ marginTop: 10, color: '#97a7c3', fontSize: 13 }}>
                Используйте шаблон для вкладки «{activeListLabel}», заполните строки и загрузите файл обратно.
              </div>
              {importResult && (
                <div className="panel" style={{ marginTop: 12 }}>
                  <div><b>Успешно:</b> {importResult.success}</div>
                  <div><b>Ошибок:</b> {importResult.failed}</div>
                  {!!importResult.errors?.length && (
                    <div style={{ marginTop: 8, color: '#ff9aa5' }}>
                      {importResult.errors.map((err) => <div key={err}>{err}</div>)}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </Modal>
      )}

      {bulkEditOpen && (
        <Modal title="Изменение выбранных ваучеров" onClose={() => setBulkEditOpen(false)}>
          <div className="form-grid">
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Город</div>
              <select
                value={bulkEditData.cityId}
                onChange={(e) => setBulkEditData((v) => ({ ...v, cityId: e.target.value, studioId: '', courseId: '' }))}
              >
                <option value="">Не менять</option>
                {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Студия</div>
              <select
                value={bulkEditData.studioId}
                onChange={(e) => setBulkEditData((v) => ({ ...v, studioId: e.target.value, courseId: '' }))}
              >
                <option value="">Не менять</option>
                {studios
                  .filter((studio) => !bulkEditData.cityId || Number(studio.cityId) === Number(bulkEditData.cityId))
                  .map((studio) => <option key={studio.id} value={studio.id}>{studio.name}</option>)}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Кружок</div>
              <select
                value={bulkEditData.courseId}
                onChange={(e) => setBulkEditData((v) => ({ ...v, courseId: e.target.value }))}
              >
                <option value="">Не менять</option>
                {courses
                  .filter((course) => !bulkEditData.studioId || Number(course.studioId) === Number(bulkEditData.studioId))
                  .map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Тип пометки</div>
              <select
                value={bulkEditData.messageTagMode || ''}
                onChange={(e) => {
                  const next = e.target.value;
                  setBulkEditData((v) => ({
                    ...v,
                    messageTagMode: next,
                    messageTag: next === 'custom' ? (v.messageTagMode === 'custom' ? v.messageTag : '') : next
                  }));
                }}
              >
                <option value="">Не менять</option>
                <option value="qr">QR</option>
                <option value="reminder">Напоминание</option>
                <option value="custom">Своя пометка</option>
              </select>
            </label>
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Своя пометка</div>
              <input
                value={bulkEditData.messageTagMode === 'custom' ? bulkEditData.messageTag : ''}
                onChange={(e) => setBulkEditData((v) => ({ ...v, messageTag: e.target.value }))}
                placeholder="Не менять"
                disabled={bulkEditData.messageTagMode !== 'custom'}
              />
            </label>
            <label className="full">
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Номер ваучера</div>
              <input
                value={bulkEditData.voucherNumber}
                onChange={(e) => setBulkEditData((v) => ({ ...v, voucherNumber: e.target.value }))}
                placeholder="Не менять"
              />
            </label>
          </div>
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ color: '#97a7c3' }}>Выбрано детей: {selectedRows.length}</div>
            <button className="primary" type="button" onClick={applyBulkEditToSelectedVouchers}>
              Применить изменения
            </button>
          </div>
        </Modal>
      )}

      {damubalaSyncModalOpen && (
        <Modal title="Синхронизация с Damubala" onClose={() => !damubalaSyncing && setDamubalaSyncModalOpen(false)}>
          {!damubalaPreview && (
            <div className="form-grid">
              {damubalaSyncing && (
                <div className="full queue-refresh-wrap" style={{ marginTop: 2 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{damubalaSyncLoadingText || 'Загрузка данных...'}</div>
                </div>
              )}
              {!damubalaSyncing && (
                <div className="full" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="primary" type="button" onClick={startDamubalaPreviewLoad}>
                    Войти в Damubala и получить заявки
                  </button>
                </div>
              )}
            </div>
          )}

          {damubalaPreview && (
            <div>
              <div style={{ color: '#97a7c3', marginBottom: 10 }}>
                Выберите номера заявок, детей из которых нужно импортировать.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => selectAllDamubalaApplications(true)}>Выбрать все</button>
                <button type="button" onClick={() => selectAllDamubalaApplications(false)}>Снять выбор</button>
              </div>
              <div className="panel" style={{ maxHeight: 300, overflow: 'auto', padding: 10 }}>
                {(damubalaPreview.applications || []).map((app) => (
                  <label key={app.applicationId} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, marginBottom: 8 }}>
                    <input
                      type="checkbox"
                      checked={!!damubalaSelectedApps[app.applicationId]}
                      onChange={(e) => toggleDamubalaApplication(app.applicationId, e.target.checked)}
                    />
                    <div>
                      <b>{app.applicationName || `Заявка #${app.applicationId}`}</b> • №{app.applicationId} • детей: {app.childrenCount}
                      <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                        Город: {app.cityName || '—'} • Студия: {app.studioName || '—'} • Кружок: {app.courseName || '—'}
                      </div>
                      {!!app.childNames?.length && (
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          {app.childNames.join(', ')}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
                {!damubalaPreview.applications?.length && <div>Нет заявок с активными ваучерами.</div>}
              </div>
              {damubalaSyncing && (
                <div className="queue-refresh-wrap" style={{ marginTop: 10 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{damubalaSyncLoadingText || 'Импорт...'}</div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setDamubalaPreview(null);
                    setDamubalaSelectedApps({});
                  }}
                  disabled={damubalaSyncing}
                >
                  Назад
                </button>
                <button className="primary" type="button" onClick={importSelectedDamubalaChildren} disabled={damubalaSyncing}>
                  Импортировать выбранных детей
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {qosymshaSyncModalOpen && (
        <Modal title="Синхронизация с Qosymsha" onClose={() => !qosymshaSyncing && setQosymshaSyncModalOpen(false)}>
          {!qosymshaPreview && (
            <div className="form-grid">
              {qosymshaSyncing && (
                <div className="full queue-refresh-wrap" style={{ marginTop: 2 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{qosymshaSyncLoadingText || 'Загрузка данных...'}</div>
                  <div className="queue-refresh-progress">
                    <div className="queue-refresh-progress-head">
                      <span>Прогресс загрузки</span>
                      <b>{Math.min(100, Math.round(qosymshaSyncProgress || 0))}%</b>
                    </div>
                    <div className="queue-refresh-track">
                      <div className="queue-refresh-fill" style={{ width: `${Math.min(100, qosymshaSyncProgress || 0)}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {!qosymshaSyncing && (
                <div className="full" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="primary" type="button" onClick={startQosymshaPreviewLoad}>
                    Войти в Qosymsha и получить детей
                  </button>
                </div>
              )}
            </div>
          )}

          {qosymshaPreview && (
            <div>
              <div style={{ color: '#97a7c3', marginBottom: 10 }}>
                Выберите детей, которых нужно импортировать.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => selectAllQosymshaChildren(true)}>Выбрать все</button>
                <button type="button" onClick={() => selectAllQosymshaChildren(false)}>Снять выбор</button>
              </div>
              <div className="panel" style={{ maxHeight: 340, overflow: 'auto', padding: 10 }}>
                {(qosymshaPreview.items || []).map((item, idx) => {
                  const key = qosymshaChildKey(item, idx);
                  return (
                    <label key={key} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!qosymshaSelectedChildren[key]}
                        onChange={(e) => toggleQosymshaChild(item, idx, e.target.checked)}
                      />
                      <div>
                        <b>{item.childFullName || `Ребенок ${idx + 1}`}</b>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          ИИН ребенка: {item.childIIN || '—'} • ИИН родителя: {item.parentIIN || '—'}
                        </div>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          Родитель: {item.parentFullName || '—'} • Телефон: {item.parentPhone || '—'}
                        </div>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          Город: {item.cityName || '—'} • Студия: {item.studioName || '—'} • Кружок: {item.courseName || '—'}
                        </div>
                      </div>
                    </label>
                  );
                })}
                {!qosymshaPreview.items?.length && <div>Не найдено карточек детей на странице.</div>}
              </div>
              {qosymshaSyncing && (
                <div className="queue-refresh-wrap" style={{ marginTop: 10 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{qosymshaSyncLoadingText || 'Импорт...'}</div>
                  <div className="queue-refresh-progress">
                    <div className="queue-refresh-progress-head">
                      <span>Прогресс загрузки</span>
                      <b>{Math.min(100, Math.round(qosymshaSyncProgress || 0))}%</b>
                    </div>
                    <div className="queue-refresh-track">
                      <div className="queue-refresh-fill" style={{ width: `${Math.min(100, qosymshaSyncProgress || 0)}%` }} />
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setQosymshaPreview(null);
                    setQosymshaSelectedChildren({});
                    setQosymshaImportResult(null);
                  }}
                  disabled={qosymshaSyncing}
                >
                  Назад
                </button>
                <button className="primary" type="button" onClick={importSelectedQosymshaChildren} disabled={qosymshaSyncing}>
                  Импортировать выбранных детей
                </button>
              </div>
              {qosymshaImportResult && (
                <div className="panel" style={{ marginTop: 12 }}>
                  <div><b>Итог импорта Qosymsha</b></div>
                  <div>Выбрано: {qosymshaImportResult.selected}</div>
                  <div>Получено: {qosymshaImportResult.fetched}</div>
                  <div>Добавлено: {qosymshaImportResult.added}</div>
                  <div>Обновлено: {qosymshaImportResult.updated}</div>
                  <div>Пропущено: {qosymshaImportResult.skipped}</div>
                  {!!qosymshaImportResult.newChildren?.length && (
                    <div style={{ marginTop: 8 }}>
                      <b>Новые дети в базе:</b>
                      <div>{qosymshaImportResult.newChildren.join(', ')}</div>
                    </div>
                  )}
                  {!!qosymshaImportResult.errors?.length && (
                    <div style={{ marginTop: 8, color: '#ff9aa5' }}>
                      {qosymshaImportResult.errors.map((err) => <div key={err}>{err}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {artsportSyncModalOpen && (
        <Modal title="Синхронизация с Artsport" onClose={() => !artsportSyncing && setArtsportSyncModalOpen(false)}>
          {!artsportPreview && (
            <div className="form-grid">
              {artsportSyncing && (
                <div className="full queue-refresh-wrap" style={{ marginTop: 2 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{artsportSyncLoadingText || 'Загрузка данных...'}</div>
                  <div className="queue-refresh-progress">
                    <div className="queue-refresh-progress-head">
                      <span>Прогресс загрузки</span>
                      <b>{Math.min(100, Math.round(artsportSyncProgress || 0))}%</b>
                    </div>
                    <div className="queue-refresh-track">
                      <div className="queue-refresh-fill" style={{ width: `${Math.min(100, artsportSyncProgress || 0)}%` }} />
                    </div>
                  </div>
                </div>
              )}
              {!artsportSyncing && (
                <div className="full" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button className="primary" type="button" onClick={startArtsportPreviewLoad}>
                    Войти в Artsport и получить детей
                  </button>
                </div>
              )}
            </div>
          )}

          {artsportPreview && (
            <div>
              <div style={{ color: '#97a7c3', marginBottom: 10 }}>
                Выберите детей из Artsport, которых нужно импортировать.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button type="button" onClick={() => selectAllArtsportChildren(true)}>Выбрать все</button>
                <button type="button" onClick={() => selectAllArtsportChildren(false)}>Снять выбор</button>
              </div>
              <div className="panel" style={{ maxHeight: 340, overflow: 'auto', padding: 10 }}>
                {(artsportPreview.items || []).map((item, idx) => {
                  const key = qosymshaChildKey(item, idx);
                  return (
                    <label key={key} style={{ display: 'grid', gridTemplateColumns: '24px 1fr', gap: 8, marginBottom: 8 }}>
                      <input
                        type="checkbox"
                        checked={!!artsportSelectedChildren[key]}
                        onChange={(e) => toggleArtsportChild(item, idx, e.target.checked)}
                      />
                      <div>
                        <b>{item.childFullName || `Ребенок ${idx + 1}`}</b>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          Родитель: {item.parentFullName || '—'} • Телефон: {item.parentPhone || '—'}
                        </div>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          ИИН ребенка: {item.childIIN || '—'} • ИИН родителя: {item.parentIIN || '—'} • Email: {item.parentEmail || '—'}
                        </div>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          Студия: {item.studioName || '—'} • Кружок: {item.courseName || '—'}
                        </div>
                        <div style={{ color: '#97a7c3', fontSize: 12, marginTop: 2 }}>
                          Ваучер: {item.voucherNumber || '—'} • Дата активации: {item.enrollmentDate || '—'}
                        </div>
                      </div>
                    </label>
                  );
                })}
                {!artsportPreview.items?.length && <div>Не найдено активированных детей в Artsport.</div>}
              </div>
              {artsportSyncing && (
                <div className="queue-refresh-wrap" style={{ marginTop: 10 }}>
                  <div className="queue-refresh-spinner" />
                  <div className="queue-refresh-text">{artsportSyncLoadingText || 'Импорт...'}</div>
                  <div className="queue-refresh-progress">
                    <div className="queue-refresh-progress-head">
                      <span>Прогресс загрузки</span>
                      <b>{Math.min(100, Math.round(artsportSyncProgress || 0))}%</b>
                    </div>
                    <div className="queue-refresh-track">
                      <div className="queue-refresh-fill" style={{ width: `${Math.min(100, artsportSyncProgress || 0)}%` }} />
                    </div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => {
                    setArtsportPreview(null);
                    setArtsportSelectedChildren({});
                    setArtsportImportResult(null);
                  }}
                  disabled={artsportSyncing}
                >
                  Назад
                </button>
                <button className="primary" type="button" onClick={importSelectedArtsportChildren} disabled={artsportSyncing}>
                  Импортировать выбранных детей
                </button>
              </div>
              {artsportImportResult && (
                <div className="panel" style={{ marginTop: 12 }}>
                  <div><b>Итог импорта Artsport</b></div>
                  <div>Выбрано: {artsportImportResult.selected}</div>
                  <div>Получено: {artsportImportResult.fetched}</div>
                  <div>Добавлено: {artsportImportResult.added}</div>
                  <div>Обновлено: {artsportImportResult.updated}</div>
                  <div>Пропущено: {artsportImportResult.skipped}</div>
                  {!!artsportImportResult.newChildren?.length && (
                    <div style={{ marginTop: 8 }}>
                      <b>Новые дети в базе:</b>
                      <div>{artsportImportResult.newChildren.join(', ')}</div>
                    </div>
                  )}
                  {!!artsportImportResult.errors?.length && (
                    <div style={{ marginTop: 8, color: '#ff9aa5' }}>
                      {artsportImportResult.errors.map((err) => <div key={err}>{err}</div>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {queueRefreshOpen && (
        <Modal title="Обновление очереди" onClose={() => setQueueRefreshOpen(false)}>
          {queueRefreshing && (
            <div className="queue-refresh-wrap">
              <div className="queue-refresh-spinner" />
              <div className="queue-refresh-text">Идет обновление очереди...</div>
              <div className="queue-refresh-progress">
                <div className="queue-refresh-progress-head">
                  <span>Прогресс обновления</span>
                  <b>{Math.min(100, Math.round(queueRefreshProgress))}%</b>
                </div>
                <div className="queue-refresh-track">
                  <div className="queue-refresh-fill" style={{ width: `${Math.min(100, queueRefreshProgress)}%` }} />
                </div>
              </div>
            </div>
          )}

          {!queueRefreshing && queueRefreshResult && (
            <div className="queue-refresh-result">
              <div className="queue-refresh-stats">
                Обработано: {queueRefreshResult.total}, обновлено: {queueRefreshResult.updated}, получили ваучер: {queueRefreshResult.voucherCount || 0}, ошибок: {queueRefreshResult.failed}
              </div>
              <div className="panel" style={{ marginTop: 10 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Ребенок</th>
                      <th>ИИН</th>
                      <th>Сдвиг</th>
                      <th>Номер</th>
                      <th>Дата постановки</th>
                      <th>Категория</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueRefreshResult.items
                      .filter((x) => x.status === 'ok')
                      .map((item, idx) => (
                        <tr key={`${item.id}-${idx}`}>
                          <td>{item.childFullName || '—'}</td>
                          <td>{item.iin}</td>
                          <td>{renderQueueShiftBadge(item.queueShift)}</td>
                          <td>{formatQueueNumber(item.queueNumber)}</td>
                          <td>{item.queueDate || '—'}</td>
                          <td>{item.queueCategory || '—'}</td>
                        </tr>
                      ))}
                    {!queueRefreshResult.items.some((x) => x.status === 'ok') && (
                      <tr><td colSpan={6}>Нет обновленных детей</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="panel" style={{ marginTop: 10 }}>
                <div style={{ marginBottom: 8, color: '#97a7c3' }}>Дети, у которых очередь пропала (получили ваучер)</div>
                <table>
                  <thead>
                    <tr>
                      <th>ФИО ребенка</th>
                      <th>Возраст</th>
                      <th>Город</th>
                      <th>Студия</th>
                      <th>Номер очереди</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueRefreshResult.items
                      .filter((x) => x.status === 'voucher')
                      .map((item, idx) => (
                        <tr key={`voucher-${item.id}-${idx}`}>
                          <td>{item.childFullName || '—'}</td>
                          <td>{item.childAge ?? '—'}</td>
                          <td>{item.cityName || '—'}</td>
                          <td>{item.studioName || '—'}</td>
                          <td>ВАУЧЕР</td>
                        </tr>
                      ))}
                    {!queueRefreshResult.items.some((x) => x.status === 'voucher') && (
                      <tr><td colSpan={5}>Нет детей, получивших ваучер</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}
