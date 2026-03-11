import React, { useEffect, useMemo, useState } from 'react';
import { api } from '@renderer/api';
import EntityModal from '@components/EntityModal';

const weekdays = [
  { value: 1, label: 'Понедельник' },
  { value: 2, label: 'Вторник' },
  { value: 3, label: 'Среда' },
  { value: 4, label: 'Четверг' },
  { value: 5, label: 'Пятница' },
  { value: 6, label: 'Суббота' },
  { value: 7, label: 'Воскресенье' }
];

function scheduleLabel(schedule) {
  if (!schedule?.length) return 'Без расписания';
  return schedule
    .map((s) => {
      const day = weekdays.find((w) => w.value === Number(s.weekday))?.label?.slice(0, 2) || s.weekday;
      const from = s.startTime || '--:--';
      const to = s.endTime || '--:--';
      return `${day} ${from}-${to}`;
    })
    .join(', ');
}

export default function StructurePage() {
  const [tree, setTree] = useState([]);
  const [view, setView] = useState('cities');
  const [selectedCityId, setSelectedCityId] = useState('');
  const [selectedStudioId, setSelectedStudioId] = useState('');
  const [expandedCourseId, setExpandedCourseId] = useState('');
  const [activeGroupByCourse, setActiveGroupByCourse] = useState({});
  const [error, setError] = useState('');

  const [cityModal, setCityModal] = useState(null);
  const [studioModal, setStudioModal] = useState(null);
  const [courseModal, setCourseModal] = useState(null);
  const [groupModal, setGroupModal] = useState(null);

  const [scheduleTarget, setScheduleTarget] = useState(null);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [savingSchedule, setSavingSchedule] = useState(false);

  async function load() {
    const structure = await api.listStructure();
    setTree(structure);
  }

  useEffect(() => {
    load();
  }, []);

  const selectedCity = useMemo(() => tree.find((c) => String(c.id) === String(selectedCityId)), [tree, selectedCityId]);
  const cityStudios = selectedCity?.studios || [];
  const selectedStudio = useMemo(
    () => cityStudios.find((s) => String(s.id) === String(selectedStudioId)),
    [cityStudios, selectedStudioId]
  );

  useEffect(() => {
    if (!selectedCityId && tree.length) {
      setSelectedCityId(String(tree[0].id));
    }
  }, [tree]);

  useEffect(() => {
    if (selectedCityId && !tree.some((c) => String(c.id) === String(selectedCityId))) {
      setSelectedCityId(tree[0] ? String(tree[0].id) : '');
      setSelectedStudioId('');
      setExpandedCourseId('');
      setScheduleTarget(null);
      setScheduleRows([]);
    }
  }, [tree, selectedCityId]);

  useEffect(() => {
    if (!selectedCity) return;
    if (selectedStudioId && !cityStudios.some((s) => String(s.id) === String(selectedStudioId))) {
      setSelectedStudioId('');
      setExpandedCourseId('');
      setScheduleTarget(null);
      setScheduleRows([]);
    }
  }, [selectedCityId, tree]);

  async function remove(kind, id, text) {
    if (!window.confirm(text)) return;
    try {
      if (kind === 'city') await api.deleteCity(id);
      if (kind === 'studio') await api.deleteStudio(id);
      if (kind === 'course') await api.deleteCourse(id);
      if (kind === 'group') await api.deleteGroup(id);
      await load();
    } catch (e) {
      setError(e?.message || 'Не удалось удалить запись.');
    }
  }

  function openCity(cityId) {
    setSelectedCityId(String(cityId));
    setSelectedStudioId('');
    setExpandedCourseId('');
    setScheduleTarget(null);
    setScheduleRows([]);
    setView('studios');
  }

  function openStudio(studioId) {
    setSelectedStudioId(String(studioId));
    setExpandedCourseId('');
    setScheduleTarget(null);
    setScheduleRows([]);
    setView('courses');
  }

  async function loadGroupSchedule(course, group) {
    const schedule = await api.listGroupSchedule(group.id);
    setScheduleTarget({
      groupId: group.id,
      groupName: group.name,
      courseId: course.id,
      courseName: course.name
    });
    setScheduleRows(Array.isArray(schedule) ? schedule : []);
  }

  async function toggleCourse(course) {
    const next = String(expandedCourseId) === String(course.id) ? '' : String(course.id);
    setExpandedCourseId(next);
    if (!next) {
      setScheduleTarget(null);
      setScheduleRows([]);
      return;
    }
    const firstGroup = course.groups?.[0];
    if (firstGroup) {
      setActiveGroupByCourse((prev) => ({ ...prev, [course.id]: firstGroup.id }));
      await loadGroupSchedule(course, firstGroup);
    } else {
      setScheduleTarget({ groupId: null, groupName: '', courseId: course.id, courseName: course.name });
      setScheduleRows([]);
    }
  }

  async function selectGroup(course, group) {
    setActiveGroupByCourse((prev) => ({ ...prev, [course.id]: group.id }));
    await loadGroupSchedule(course, group);
  }

  function setDayEnabled(weekday, enabled) {
    setScheduleRows((prev) => {
      const exists = prev.find((x) => Number(x.weekday) === Number(weekday));
      if (enabled && !exists) {
        return [...prev, { weekday: Number(weekday), startTime: '18:00', endTime: '19:00' }];
      }
      if (!enabled && exists) {
        return prev.filter((x) => Number(x.weekday) !== Number(weekday));
      }
      return prev;
    });
  }

  function setDayTime(weekday, field, value) {
    setScheduleRows((prev) => prev.map((x) => (Number(x.weekday) === Number(weekday) ? { ...x, [field]: value } : x)));
  }

  async function saveSchedule() {
    if (!scheduleTarget?.groupId) return;
    setSavingSchedule(true);
    try {
      const items = scheduleRows
        .filter((x) => x.startTime && x.endTime)
        .map((x) => ({ weekday: Number(x.weekday), startTime: x.startTime, endTime: x.endTime }));
      await api.saveGroupSchedule({ groupId: scheduleTarget.groupId, items });
      await load();
      const refreshed = await api.listGroupSchedule(scheduleTarget.groupId);
      setScheduleRows(Array.isArray(refreshed) ? refreshed : []);
    } catch (e) {
      setError(e?.message || 'Не удалось сохранить расписание.');
    } finally {
      setSavingSchedule(false);
    }
  }

  function goBack() {
    if (view === 'courses') {
      setView('studios');
      setSelectedStudioId('');
      setExpandedCourseId('');
      setScheduleTarget(null);
      setScheduleRows([]);
      return;
    }
    if (view === 'studios') {
      setView('cities');
      setExpandedCourseId('');
      setScheduleTarget(null);
      setScheduleRows([]);
    }
  }

  const breadcrumb = [
    'Города',
    selectedCity?.name,
    selectedStudio?.name
  ].filter(Boolean).join(' / ');

  return (
    <section className="structure-v3-page">
      <h1 className="page-title">Моя организация</h1>
      <p className="page-subtitle">Пошаговая структура: выберите город, зайдите в студию, затем управляйте кружками, группами и расписанием.</p>
      {error && <p style={{ color: '#ff6978' }}>{error}</p>}

      <div className="panel structure-v3-shell">
        <div className="structure-v3-topbar">
          <div className="structure-v3-left">
            {view !== 'cities' && <button onClick={goBack}>← Назад</button>}
            <div className="structure-v3-breadcrumb">{breadcrumb}</div>
          </div>

          <div className="structure-v3-right">
            {view === 'cities' && <button className="primary" onClick={() => setCityModal({})}>+ Город</button>}
            {view === 'studios' && <button className="primary" onClick={() => setStudioModal({ cityId: selectedCity?.id || '' })}>+ Студия</button>}
            {view === 'courses' && <button className="primary" onClick={() => setCourseModal({ studioId: selectedStudio?.id || '' })}>+ Кружок</button>}
          </div>
        </div>

        {view === 'cities' && (
          <div className="structure-v3-list">
            {tree.map((city) => (
              <div key={city.id} className="structure-v3-row" onClick={() => openCity(city.id)}>
                <div className="structure-v3-row-main">
                  <div className="structure-v3-row-title">{city.name}</div>
                  <div className="structure-v3-row-meta">Студий: {city.studios?.length || 0} • Детей: {city.childrenCount || 0}</div>
                </div>
                <div className="icon-actions">
                  <button className="icon-btn" title="Редактировать" onClick={(e) => { e.stopPropagation(); setCityModal(city); }}>⋯</button>
                  <button className="icon-btn danger" title="Удалить" onClick={(e) => { e.stopPropagation(); remove('city', city.id, 'Удалить город?'); }}>🗑</button>
                </div>
              </div>
            ))}
            {!tree.length && <div className="structure-v3-empty">Добавьте первый город.</div>}
          </div>
        )}

        {view === 'studios' && (
          <div className="structure-v3-list">
            {cityStudios.map((studio) => (
              <div key={studio.id} className="structure-v3-row" onClick={() => openStudio(studio.id)}>
                <div className="structure-v3-row-main">
                  <div className="structure-v3-row-title">{studio.name}</div>
                  <div className="structure-v3-row-meta">Кружков: {studio.courses?.length || 0} • Детей: {studio.childrenCount || 0}</div>
                </div>
                <div className="icon-actions">
                  <button className="icon-btn" title="Редактировать" onClick={(e) => { e.stopPropagation(); setStudioModal(studio); }}>⋯</button>
                  <button className="icon-btn danger" title="Удалить" onClick={(e) => { e.stopPropagation(); remove('studio', studio.id, 'Удалить студию?'); }}>🗑</button>
                </div>
              </div>
            ))}
            {!cityStudios.length && <div className="structure-v3-empty">В выбранном городе нет студий.</div>}
          </div>
        )}

        {view === 'courses' && (
          <div className="structure-v3-courses-wrap">
            <div className="structure-v3-courses">
              {(selectedStudio?.courses || []).map((course) => {
                const expanded = String(expandedCourseId) === String(course.id);
                const activeGroupId = activeGroupByCourse[course.id];
                const visibleGroups = course.groups || [];
                return (
                  <div key={course.id} className={`structure-v3-course${expanded ? ' expanded' : ''}`}>
                    <div className="structure-v3-course-head">
                      <button className="structure-v3-course-toggle" onClick={() => toggleCourse(course)}>
                        <span>{course.name}</span>
                        <small>Групп: {course.groups?.length || 0} • Детей: {course.childrenCount || 0}</small>
                      </button>
                      <div className="row-actions">
                        <button onClick={() => setCourseModal(course)}>⋯</button>
                        <button onClick={() => remove('course', course.id, 'Удалить кружок?')}>🗑</button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="structure-v3-course-body">
                        <div className="structure-v3-course-tools">
                          <button onClick={() => setGroupModal({ courseId: course.id })}>+ Группа</button>
                        </div>

                        <div className="structure-v3-group-tabs">
                          {visibleGroups.map((group) => (
                            <button
                              key={group.id}
                              className={`structure-v3-group-tab${String(activeGroupId) === String(group.id) ? ' active' : ''}`}
                              onClick={() => {
                                if (String(activeGroupId) === String(group.id)) {
                                  setGroupModal(group);
                                } else {
                                  selectGroup(course, group);
                                }
                              }}
                              title={String(activeGroupId) === String(group.id) ? 'Нажмите, чтобы изменить название группы' : 'Открыть группу'}
                            >
                              {group.name} <small>({group.childrenCount || 0})</small>
                            </button>
                          ))}
                          {!course.groups?.length && <div className="structure-v3-empty">Добавьте группу, чтобы настроить расписание.</div>}
                        </div>

                        {!!course.groups?.length && scheduleTarget?.courseId === course.id && (
                          <div className="structure-v3-schedule">
                            <div className="structure-v3-schedule-head">
                              <div>
                                <div className="structure-v3-schedule-title">Расписание группы: {scheduleTarget.groupName}</div>
                                <div className="structure-v3-schedule-meta">{scheduleRows.length ? scheduleLabel(scheduleRows) : 'Без расписания'}</div>
                              </div>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const currentGroup = (course.groups || []).find((g) => String(g.id) === String(scheduleTarget.groupId));
                                    if (currentGroup) setGroupModal(currentGroup);
                                  }}
                                >
                                  Изменить группу
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => remove('group', scheduleTarget.groupId, 'Удалить эту группу?')}
                                  disabled={!scheduleTarget.groupId}
                                >
                                  Удалить группу
                                </button>
                                <button className="primary" onClick={saveSchedule} disabled={savingSchedule}>
                                  {savingSchedule ? 'Сохранение...' : 'Сохранить'}
                                </button>
                              </div>
                            </div>

                            <div className="structure-v3-schedule-table">
                              <div className="structure-v3-schedule-headrow">
                                <div>День недели</div>
                                <div>Время занятия</div>
                              </div>
                              {weekdays.map((day) => {
                                const row = scheduleRows.find((x) => Number(x.weekday) === day.value);
                                return (
                                  <div key={day.value} className="structure-v3-schedule-row">
                                    <label className="structure-v3-day">
                                      <input
                                        type="checkbox"
                                        checked={!!row}
                                        onChange={(e) => setDayEnabled(day.value, e.target.checked)}
                                      />
                                      <span>{day.label}</span>
                                    </label>
                                    <div className="structure-v3-time">
                                      <input
                                        type="time"
                                        value={row?.startTime || ''}
                                        disabled={!row}
                                        onChange={(e) => setDayTime(day.value, 'startTime', e.target.value)}
                                      />
                                      <span>—</span>
                                      <input
                                        type="time"
                                        value={row?.endTime || ''}
                                        disabled={!row}
                                        onChange={(e) => setDayTime(day.value, 'endTime', e.target.value)}
                                      />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {!selectedStudio?.courses?.length && <div className="structure-v3-empty">В этой студии пока нет кружков.</div>}
            </div>
          </div>
        )}
      </div>

      {cityModal && (
        <EntityModal
          title={cityModal.id ? 'Редактировать город' : 'Новый город'}
          initialValue={cityModal}
          fields={[{ key: 'name', label: 'Название города' }]}
          onClose={() => setCityModal(null)}
          onSubmit={async (payload) => {
            await api.saveCity(payload);
            setCityModal(null);
            await load();
          }}
        />
      )}

      {studioModal && (
        <EntityModal
          title={studioModal.id ? 'Редактировать студию' : 'Новая студия'}
          initialValue={studioModal}
          fields={[
            { key: 'name', label: 'Название студии' },
            {
              key: 'cityId',
              label: 'Город',
              type: 'select',
              options: tree.map((city) => ({ value: city.id, label: city.name }))
            }
          ]}
          onClose={() => setStudioModal(null)}
          onSubmit={async (payload) => {
            await api.saveStudio(payload);
            setStudioModal(null);
            await load();
          }}
        />
      )}

      {courseModal && (
        <EntityModal
          title={courseModal.id ? 'Редактировать кружок' : 'Новый кружок'}
          initialValue={courseModal}
          fields={[
            { key: 'name', label: 'Название кружка' },
            {
              key: 'studioId',
              label: 'Студия',
              type: 'select',
              options: cityStudios.map((s) => ({ value: s.id, label: s.name }))
            }
          ]}
          onClose={() => setCourseModal(null)}
          onSubmit={async (payload) => {
            await api.saveCourse(payload);
            setCourseModal(null);
            await load();
          }}
        />
      )}

      {groupModal && (
        <EntityModal
          title={groupModal.id ? 'Редактировать группу' : 'Новая группа'}
          initialValue={groupModal}
          fields={[
            { key: 'name', label: 'Название группы' },
            ...(groupModal.id
              ? []
              : [
                  {
                    key: 'courseId',
                    label: 'Кружок',
                    type: 'select',
                    options: (selectedStudio?.courses || []).map((c) => ({ value: c.id, label: c.name }))
                  }
                ])
          ]}
          onClose={() => setGroupModal(null)}
          onSubmit={async (payload) => {
            await api.saveGroup(payload);
            setGroupModal(null);
            await load();
          }}
        />
      )}

    </section>
  );
}
