import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';

const initialVoucher = {
  parentFullName: '',
  parentIIN: '',
  parentEmail: '',
  parentPhone: '',
  childFullName: '',
  childIIN: '',
  childBirthDate: '',
  manualAge: '',
  voucherNumber: '',
  enrollmentDate: '',
  voucherEndDate: ''
};

const initialPaid = {
  childFullName: '',
  childIIN: '',
  childBirthDate: '',
  manualAge: '',
  parentPhone: '',
  parentFullName: '',
  enrollmentDate: '',
  paymentStartDate: '',
  lastPaymentDate: '',
  lessonsCount: 0
};

function parseBirthDateFromIin(iinRaw) {
  const iin = String(iinRaw || '').replace(/\D/g, '');
  if (iin.length < 6) return '';

  const yy = Number(iin.slice(0, 2));
  const mm = Number(iin.slice(2, 4));
  const dd = Number(iin.slice(4, 6));
  const nowYY = new Date().getFullYear() % 100;
  const year = yy <= nowYY ? 2000 + yy : 1900 + yy;

  const dt = new Date(year, mm - 1, dd);
  if (dt.getFullYear() !== year || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return '';
  return `${year.toString().padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function ageFromBirthDate(iso) {
  if (!iso) return '';
  const birth = new Date(iso);
  if (Number.isNaN(birth.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return Math.max(0, age);
}

export default function ChildModal({ data, studios, courses, groups, onClose, onSubmit }) {
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    id: data?.id,
    studioId: data?.studioId || '',
    courseId: data?.courseId || '',
    groupId: data?.groupId || '',
    messageTag: data?.messageTag || '',
    type: data?.type || 'voucher',
    profile: data?.profile || initialVoucher
  });

  useEffect(() => {
    setError('');
    setForm({
      id: data?.id,
      studioId: data?.studioId || '',
      courseId: data?.courseId || '',
      groupId: data?.groupId || '',
      messageTag: data?.messageTag || '',
      type: data?.type || 'voucher',
      profile: data?.profile || initialVoucher
    });
  }, [data]);

  const currentCourses = useMemo(
    () => courses.filter((course) => Number(course.studioId) === Number(form.studioId)),
    [courses, form.studioId]
  );

  const currentGroups = useMemo(
    () => groups.filter((group) => Number(group.courseId) === Number(form.courseId)),
    [groups, form.courseId]
  );

  const hasIin = String(form.profile.childIIN || '').trim().length > 0;
  const calculatedBirthDate = hasIin ? parseBirthDateFromIin(form.profile.childIIN) : form.profile.childBirthDate;
  const calculatedAge = calculatedBirthDate ? ageFromBirthDate(calculatedBirthDate) : form.profile.manualAge;

  function switchType(newType) {
    setForm((prev) => ({
      ...prev,
      type: newType,
      profile: newType === 'voucher' ? initialVoucher : initialPaid
    }));
  }

  function updateProfile(key, value) {
    setForm((prev) => {
      const next = { ...prev.profile, [key]: value };
      if (key === 'childIIN') {
        const birth = parseBirthDateFromIin(value);
        if (birth) {
          next.childBirthDate = birth;
          next.manualAge = '';
        }
      }
      if (key === 'childBirthDate' && value) next.manualAge = '';
      if (key === 'manualAge' && value !== '') next.childBirthDate = '';
      return { ...prev, profile: next };
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    const hasBirth = !!String(form.profile.childBirthDate || '').trim();
    const hasAge = String(form.profile.manualAge || '').trim() !== '';

    if (!hasIin && !hasBirth && !hasAge) {
      setError('Укажите ИИН ребенка, дату рождения или возраст.');
      return;
    }

    if (hasIin && !/^\d{12}$/.test(String(form.profile.childIIN))) {
      setError('ИИН ребенка должен содержать 12 цифр.');
      return;
    }

    try {
      await onSubmit({
        ...form,
        studioId: Number(form.studioId),
        courseId: Number(form.courseId),
        groupId: form.groupId ? Number(form.groupId) : null,
        profile: {
          ...form.profile,
          manualAge: hasAge ? Number(form.profile.manualAge) : null,
          lessonsCount: Number(form.profile.lessonsCount || 0)
        }
      });
    } catch (err) {
      setError(err?.message || 'Не удалось сохранить ребенка.');
    }
  }

  return (
    <Modal title={form.id ? 'Редактировать ребенка' : 'Добавить ребенка'} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Студия</div>
            <select
              value={form.studioId}
              onChange={(e) => setForm((prev) => ({ ...prev, studioId: Number(e.target.value), courseId: '', groupId: '' }))}
              required
            >
              <option value="">Выберите...</option>
              {studios.map((studio) => (
                <option key={studio.id} value={studio.id}>{studio.name}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Кружок</div>
            <select
              value={form.courseId}
              onChange={(e) => setForm((prev) => ({ ...prev, courseId: Number(e.target.value), groupId: '' }))}
              required
            >
              <option value="">Выберите...</option>
              {currentCourses.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Группа</div>
            <select value={form.groupId} onChange={(e) => setForm((prev) => ({ ...prev, groupId: Number(e.target.value) || '' }))}>
              <option value="">Без группы</option>
              {currentGroups.map((group) => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Тип</div>
            <select value={form.type} onChange={(e) => switchType(e.target.value)}>
              <option value="voucher">Ваучер</option>
              <option value="paid">Платник</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Пометка</div>
            <select value={form.messageTag || ''} onChange={(e) => setForm((prev) => ({ ...prev, messageTag: e.target.value }))}>
              <option value="">Без пометки</option>
              <option value="qr">QR</option>
              <option value="reminder">Напоминание</option>
            </select>
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО ребенка</div>
            <input value={form.profile.childFullName || ''} onChange={(e) => updateProfile('childFullName', e.target.value)} required />
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН ребенка</div>
            <input value={form.profile.childIIN || ''} onChange={(e) => updateProfile('childIIN', e.target.value)} />
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата рождения</div>
            <input
              type="date"
              value={calculatedBirthDate || ''}
              onChange={(e) => updateProfile('childBirthDate', e.target.value)}
              disabled={hasIin}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Возраст</div>
            <input
              type="number"
              min="0"
              value={String(calculatedAge || '')}
              onChange={(e) => updateProfile('manualAge', e.target.value)}
              disabled={hasIin}
              readOnly={hasIin || !!form.profile.childBirthDate}
            />
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Телефон родителя</div>
            <input value={form.profile.parentPhone || ''} onChange={(e) => updateProfile('parentPhone', e.target.value)} required />
          </label>

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>ФИО родителя {form.type === 'paid' ? '(опционально)' : ''}</div>
            <input
              value={form.profile.parentFullName || ''}
              onChange={(e) => updateProfile('parentFullName', e.target.value)}
              required={form.type === 'voucher'}
            />
          </label>

          {form.type === 'voucher' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>ИИН родителя</div>
              <input value={form.profile.parentIIN || ''} onChange={(e) => updateProfile('parentIIN', e.target.value)} required />
            </label>
          )}

          {form.type === 'voucher' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Email родителя</div>
              <input value={form.profile.parentEmail || ''} onChange={(e) => updateProfile('parentEmail', e.target.value)} />
            </label>
          )}

          {form.type === 'voucher' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Номер ваучера</div>
              <input value={form.profile.voucherNumber || ''} onChange={(e) => updateProfile('voucherNumber', e.target.value)} required />
            </label>
          )}

          <label>
            <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата зачисления</div>
            <input type="date" value={form.profile.enrollmentDate || ''} onChange={(e) => updateProfile('enrollmentDate', e.target.value)} required />
          </label>

          {form.type === 'paid' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Стартовая дата оплаты</div>
              <input
                type="date"
                value={form.profile.paymentStartDate || ''}
                onChange={(e) => updateProfile('paymentStartDate', e.target.value)}
              />
            </label>
          )}

          {form.type === 'voucher' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата окончания ваучера</div>
              <input type="date" value={form.profile.voucherEndDate || ''} onChange={(e) => updateProfile('voucherEndDate', e.target.value)} required />
            </label>
          )}

          {form.type === 'paid' && (
            <label>
              <div style={{ marginBottom: 6, color: '#97a7c3' }}>Дата последней оплаты</div>
              <input type="date" value={form.profile.lastPaymentDate || ''} onChange={(e) => updateProfile('lastPaymentDate', e.target.value)} />
            </label>
          )}
        </div>

        {error && <div style={{ marginTop: 10, color: '#ff6978' }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose}>Отмена</button>
          <button className="primary" type="submit">Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
