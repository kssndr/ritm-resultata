
  const CONFIG = {
    // Номер WhatsApp: только цифры, без +, пробелов, скобок и дефисов.
    whatsappNumber: '77770278497', // Замените здесь, если номер изменится.
    storageKey: 'rrGoalDraft:v2',
    legacyStorageKey: 'rrGoalDraft:v1',
    pdfUrl: 'assets/pdf/chernovik-celi-na-4-nedeli-pamyatka.pdf',
    programUrl: 'https://wa.me/77770278497?text=' + encodeURIComponent('Здравствуйте, Инна.\nЯ познакомилась с практикой „Черновик цели на четыре недели“ и хочу узнать подробнее об участии в „Ритме результата“.')
  };

  // ---- reveal-on-scroll ----
  document.documentElement.classList.add('js');
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries)=>{
      entries.forEach(e=>{
        if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold:0.12 });
    revealEls.forEach(el=>io.observe(el));
  } else {
    revealEls.forEach(el=>el.classList.add('in'));
  }

  // ---- tri-state checklist buttons (да / нет / пока не понимаю) ----
  document.querySelectorAll('.tri').forEach(group=>{
    const opts = ['да','нет','пока не понимаю'];
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', group.parentElement.firstChild.textContent.trim());
    opts.forEach(label=>{
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.value = label;
      b.setAttribute('aria-pressed','false');
      b.addEventListener('click', ()=>{
        group.querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed','false'));
        b.setAttribute('aria-pressed','true');
        scheduleSave();
      });
      group.appendChild(b);
    });
  });

  // ---- local draft: save and restore answers on this device only ----
  const storageStatus = document.getElementById('storage-status');
  const copyAnswersButton = document.getElementById('copy-answers');
  const downloadAnswersButton = document.getElementById('download-answers');
  const clearAnswersButton = document.getElementById('clear-answers');
  let storageIsAvailable = true;
  let saveTimer;
  let goalDraftTimer;
  let legacyObstacles = [];
  let legacySupport = { selected:[], text:'' };

  const STORED_FIELD_IDS = ['goal-focus','goal-result','goal-importance','goal-time','goal-obstacles','first-step','attention-area'];
  const MIGRATED_TRI_GROUPS = ['c1','c2','c5'];
  const OBSTACLE_MIGRATION_MAP = {
    'obstacle-unclear-start': 'unclear-start',
    'obstacle-too-large': 'too-large',
    'obstacle-no-time': 'no-time',
    'obstacle-other-priorities': 'other-priorities',
    'obstacle-procrastination': 'procrastination',
    'obstacle-other': 'obstacle-other',
    'obstacle-too-many-options': 'unclear-start',
    'obstacle-stop-at-difficulty': 'procrastination',
    'obstacle-doubt': 'unclear-start',
    'obstacle-no-feedback': 'obstacle-other',
    'obstacle-switching-ideas': 'obstacle-other'
  };

  /* v2 schema:
     {
       migrationCompleted: true,
       fields: { goal-focus, goal-result, goal-importance, goal-time,
                 goal-obstacles, first-step, attention-area },
       primaryObstacle: string | null,
       availableTimeMode: string | null,
       triState: { c1, c2, c5 },
       legacyObstacles: string[],
       legacySupport: { selected: string[], text: string }
     }
  */

  function setStorageStatus(message, isWarning = false){
    storageStatus.textContent = message;
    storageStatus.classList.toggle('warning', isWarning);
  }

  function checkStorageAvailability(){
    try {
      const currentDraft = localStorage.getItem(CONFIG.storageKey);
      localStorage.setItem(CONFIG.storageKey, currentDraft ?? '');
      if (currentDraft === null) localStorage.removeItem(CONFIG.storageKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  function collectDraft(){
    const fields = {};
    STORED_FIELD_IDS.forEach(fieldId=>{
      fields[fieldId] = document.getElementById(fieldId)?.value || '';
    });

    const triState = {};
    document.querySelectorAll('.tri').forEach(group=>{
      if (!MIGRATED_TRI_GROUPS.includes(group.dataset.group)) return;
      const selected = group.querySelector('button[aria-pressed="true"]');
      triState[group.dataset.group] = selected ? selected.dataset.value : null;
    });

    const primaryObstacle = document.querySelector('input[name="primary-obstacle"]:checked')?.value || null;
    const availableTimeMode = document.querySelector('input[name="available-time-mode"]:checked')?.value || null;
    return { migrationCompleted:true, fields, primaryObstacle, availableTimeMode, triState, legacyObstacles, legacySupport };
  }

  function migrateV1Draft(draft){
    const fields = {};
    STORED_FIELD_IDS.forEach(fieldId=>{
      const value = draft.textareas?.[fieldId];
      fields[fieldId] = typeof value === 'string' ? value : '';
    });

    const selectedObstacleIds = Object.keys(draft.checkboxes || {}).filter(id=>id.startsWith('obstacle-') && draft.checkboxes[id] === true);
    let primaryObstacle = draft.primaryObstacle || null;
    let primarySourceId = primaryObstacle ? Object.keys(OBSTACLE_MIGRATION_MAP).find(id=>OBSTACLE_MIGRATION_MAP[id] === primaryObstacle && selectedObstacleIds.includes(id)) : null;
    if (!primaryObstacle && selectedObstacleIds.length) {
      primarySourceId = selectedObstacleIds[0];
      primaryObstacle = OBSTACLE_MIGRATION_MAP[primarySourceId] || 'obstacle-other';
    }

    const migratedLegacyObstacles = selectedObstacleIds.filter(id=>id !== primarySourceId);
    const selectedSupport = Object.keys(draft.checkboxes || {}).filter(id=>id.startsWith('support-') && draft.checkboxes[id] === true);
    return {
      migrationCompleted:true,
      fields,
      primaryObstacle,
      availableTimeMode:draft.availableTimeMode || null,
      triState:Object.fromEntries(MIGRATED_TRI_GROUPS.map(group=>[group, draft.triState?.[group] || null])),
      legacyObstacles:migratedLegacyObstacles,
      legacySupport:{ selected:selectedSupport, text:typeof draft.textareas?.['goal-support'] === 'string' ? draft.textareas['goal-support'] : '' }
    };
  }

  function loadDraft(){
    const savedV2 = localStorage.getItem(CONFIG.storageKey);
    if (savedV2) {
      try { return JSON.parse(savedV2); } catch (error) { /* Try the v1 backup below. */ }
    }
    const savedV1 = localStorage.getItem(CONFIG.legacyStorageKey);
    if (!savedV1) return null;
    const migrated = migrateV1Draft(JSON.parse(savedV1));
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(migrated));
    return migrated;
  }

  function saveDraft(){
    if (!storageIsAvailable) return;
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(collectDraft()));
      setStorageStatus('Ответы сохранены только на этом устройстве');
    } catch (error) {
      storageIsAvailable = false;
      setStorageStatus('Не удалось сохранить ответы на этом устройстве. Страницей можно продолжать пользоваться.', true);
    }
  }

  function scheduleSave(){
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveDraft, 400);
  }

  function getGoalDraftState(){
    const focus = document.getElementById('goal-focus').value.trim();
    const result = document.getElementById('goal-result').value.trim();
    const selectedObstacle = document.querySelector('input[name="primary-obstacle"]:checked');
    let obstacle = '';

    if (selectedObstacle?.value === 'obstacle-other') {
      obstacle = document.getElementById('goal-obstacles').value.trim();
    } else if (selectedObstacle) {
      obstacle = document.querySelector(`label[for="${selectedObstacle.id}"]`).textContent.trim();
    }

    return {
      focus,
      result,
      obstacle,
      obstaclePrompt: selectedObstacle?.value === 'obstacle-other' ? '— опишите другое препятствие' : '— выберите один вариант',
      isEmpty: !focus && !result && !selectedObstacle,
      isComplete: Boolean(focus && result && obstacle)
    };
  }

  function buildGoalDraft(){
    const state = getGoalDraftState();

    if (state.isEmpty) {
      return 'Ответьте на три вопроса — здесь появится ваш первый черновик.';
    }

    return [
      `За ближайшие четыре недели я хотела бы сдвинуть:\n${state.focus || '— добавьте ответ на вопрос 1'}`,
      `Я пойму, что продвинулась, когда:\n${state.result || '— добавьте ответ на вопрос 2'}`,
      `Сейчас мне больше всего мешает:\n${state.obstacle || state.obstaclePrompt}`
    ].join('\n\n');
  }

  function updateGoalDraft(){
    document.getElementById('goal-draft').textContent = buildGoalDraft();
    document.getElementById('goal-draft-note').hidden = !getGoalDraftState().isComplete;
  }

  function scheduleGoalDraftUpdate(){
    window.clearTimeout(goalDraftTimer);
    goalDraftTimer = window.setTimeout(updateGoalDraft, 450);
  }

  function buildAnswersText(){
    const valueOf = fieldId=>document.getElementById(fieldId)?.value.trim() || '';
    const triLabels = {
      c1: 'В моей зоне влияния',
      c2: 'Предполагает конкретный результат',
      c5: 'Помещается в доступное мне время'
    };
    const primaryObstacle = document.querySelector('input[name="primary-obstacle"]:checked');
    const obstacles = primaryObstacle ? [document.querySelector(`label[for="${primaryObstacle.id}"]`).textContent.trim()] : [];
    const timeMode = document.querySelector('input[name="available-time-mode"]:checked');
    const timeParts = [
      timeMode ? document.querySelector(`label[for="${timeMode.id}"]`).textContent.trim() : '',
      valueOf('goal-time')
    ].filter(Boolean);
    const triAnswers = Array.from(document.querySelectorAll('.tri')).map(group=>{
      const selected = group.querySelector('button[aria-pressed="true"]');
      return { label: triLabels[group.dataset.group], value: selected?.dataset.value || '' };
    });
    const answers = {
      focus: valueOf('goal-focus'),
      result: valueOf('goal-result'),
      importance: valueOf('goal-importance'),
      obstacles,
      obstaclesComment: valueOf('goal-obstacles'),
      time: timeParts.join('. '),
      firstStep: valueOf('first-step'),
      attentionArea: valueOf('attention-area'),
      triAnswers
    };
    const hasAnswers = answers.focus || answers.result || answers.importance || answers.obstacles.length ||
      answers.obstaclesComment || answers.time || answers.firstStep || answers.attentionArea ||
      answers.triAnswers.some(answer=>answer.value);

    if (!hasAnswers) return '';

    const display = value=>value || '—';
    const bulletList = values=>values.length ? values.map(value=>`- ${value}`).join('\n') : '—';
    return [
      'Черновик цели на четыре недели',
      '',
      `1. Что я хочу сдвинуть:\n${display(answers.focus)}`,
      '',
      `2. Результат к 14 августа:\n${display(answers.result)}`,
      '',
      `3. Почему это важно:\n${display(answers.importance)}`,
      '',
      `4. Что мешает:\n${bulletList(answers.obstacles)}\nКомментарий: ${display(answers.obstaclesComment)}`,
      '',
      `5. Доступное время:\n${display(answers.time)}`,
      '',
      'Проверка цели:',
      ...answers.triAnswers.map(answer=>`- ${answer.label}: ${display(answer.value)}`),
      '',
      `Первый шаг:\n${display(answers.firstStep)}`,
      '',
      `Если цель пока не складывается:\n${display(answers.attentionArea)}`
    ].join('\n');
  }

  function copyTextFallback(text){
    const temporaryField = document.createElement('textarea');
    temporaryField.value = text;
    temporaryField.setAttribute('readonly','');
    temporaryField.style.position = 'fixed';
    temporaryField.style.opacity = '0';
    document.body.appendChild(temporaryField);
    temporaryField.select();
    const copied = document.execCommand('copy');
    temporaryField.remove();
    if (!copied) throw new Error('Copy command failed');
  }

  function buildFeedbackText(){
    const state = getGoalDraftState();
    const missing = [];

    if (!state.focus) missing.push('что вы хотите сдвинуть');
    if (!state.result) missing.push('какой результат покажет продвижение');
    if (!state.obstacle) missing.push('что сейчас больше всего мешает');

    if (missing.length) return { text:'', missing };

    return {
      missing,
      text: [
        'Здравствуйте, Инна.',
        '',
        'Я прошла практику «Черновик цели на четыре недели»',
        'и хочу получить короткую обратную связь.',
        '',
        'Мой первый черновик:',
        '',
        buildGoalDraft()
      ].join('\n')
    };
  }

  async function copyFeedbackAnswers(){
    const feedback = buildFeedbackText();
    const feedbackStatus = document.getElementById('feedback-status');

    if (feedback.missing.length) {
      feedbackStatus.textContent = `Желательно заполнить: ${feedback.missing.join(', ')}.`;
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(feedback.text);
      } else {
        copyTextFallback(feedback.text);
      }
      feedbackStatus.textContent = 'Черновик скопирован. Теперь откройте WhatsApp и вставьте его в сообщение.';
    } catch (error) {
      try {
        copyTextFallback(feedback.text);
        feedbackStatus.textContent = 'Черновик скопирован. Теперь откройте WhatsApp и вставьте его в сообщение.';
      } catch (fallbackError) {
        feedbackStatus.textContent = 'Не удалось скопировать ответы. Попробуйте ещё раз.';
      }
    }
  }

  async function copyGoalDraft(){
    if (getGoalDraftState().isEmpty) {
      setStorageStatus('Сначала заполните хотя бы один ответ');
      return;
    }
    const answersText = buildGoalDraft();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(answersText);
      } else {
        copyTextFallback(answersText);
      }
      setStorageStatus('Черновик скопирован');
    } catch (error) {
      try {
        copyTextFallback(answersText);
        setStorageStatus('Черновик скопирован');
      } catch (fallbackError) {
        setStorageStatus('Не удалось скопировать ответы. Попробуйте скачать файл.', true);
      }
    }
  }

  function downloadAnswers(){
    const answersText = buildAnswersText();
    if (!answersText) {
      setStorageStatus('Сначала заполните хотя бы один ответ');
      return;
    }

    const file = new Blob(['\uFEFF', answersText], { type:'text/plain;charset=utf-8' });
    const fileUrl = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = 'chernovik-celi-moi-otvety.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(fileUrl);
    setStorageStatus('Файл с ответами сохранён');
  }

  function restoreDraft(){
    if (!storageIsAvailable) return;
    try {
      const draft = loadDraft();
      if (!draft) return;
      legacyObstacles = Array.isArray(draft.legacyObstacles) ? draft.legacyObstacles : [];
      legacySupport = {
        selected:Array.isArray(draft.legacySupport?.selected) ? draft.legacySupport.selected : [],
        text:typeof draft.legacySupport?.text === 'string' ? draft.legacySupport.text : ''
      };

      STORED_FIELD_IDS.forEach(fieldId=>{
        const field = document.getElementById(fieldId);
        const savedValue = draft.fields?.[fieldId];
        if (typeof savedValue === 'string') field.value = savedValue;
      });

      const primaryField = draft.primaryObstacle ? document.querySelector(`input[name="primary-obstacle"][value="${draft.primaryObstacle}"]`) : null;
      if (primaryField) primaryField.checked = true;
      updateObstacleOtherVisibility();
      const timeField = draft.availableTimeMode ? document.querySelector(`input[name="available-time-mode"][value="${draft.availableTimeMode}"]`) : null;
      if (timeField) timeField.checked = true;

      document.querySelectorAll('.tri').forEach(group=>{
        const savedValue = draft.triState?.[group.dataset.group];
        group.querySelectorAll('button').forEach(button=>{
          button.setAttribute('aria-pressed', String(button.dataset.value === savedValue));
        });
      });
    } catch (error) {
      setStorageStatus('Сохранённые ответы не удалось восстановить. Можно заполнить страницу заново.', true);
    }
  }

  function clearAnswers(){
    if (!window.confirm('Удалить все сохранённые ответы с этого устройства?')) return;

    window.clearTimeout(saveTimer);
    window.clearTimeout(goalDraftTimer);

    // Успех показываем только после отдельного удаления и проверки обоих ключей.
    let deletionSucceeded = true;
    try {
      localStorage.removeItem(CONFIG.legacyStorageKey);
    } catch (error) {
      deletionSucceeded = false;
    }
    try {
      localStorage.removeItem(CONFIG.storageKey);
    } catch (error) {
      deletionSucceeded = false;
    }
    try {
      if (localStorage.getItem(CONFIG.legacyStorageKey) !== null ||
          localStorage.getItem(CONFIG.storageKey) !== null) {
        deletionSucceeded = false;
      }
    } catch (error) {
      deletionSucceeded = false;
    }

    if (!deletionSucceeded) {
      setStorageStatus('Не удалось удалить локально сохранённые ответы. Проверьте настройки браузера или очистите данные сайта вручную', true);
      return;
    }

    document.querySelectorAll('textarea[data-field]').forEach(field=>{ field.value = ''; });
    document.querySelectorAll('input[name="primary-obstacle"]').forEach(field=>{ field.checked = false; });
    document.querySelectorAll('input[name="available-time-mode"]').forEach(field=>{ field.checked = false; });
    legacyObstacles = [];
    legacySupport = { selected:[], text:'' };
    updateObstacleOtherVisibility();
    document.querySelectorAll('.tri button').forEach(button=>{ button.setAttribute('aria-pressed','false'); });
    updateGoalDraft();
    setStorageStatus('Ответы удалены с этого устройства');
  }

  storageIsAvailable = checkStorageAvailability();
  if (storageIsAvailable) {
    restoreDraft();
  } else {
    setStorageStatus('Локальное сохранение недоступно. Страницей можно продолжать пользоваться.', true);
  }
  updateGoalDraft();

  document.querySelectorAll('textarea[data-field]').forEach(field=>field.addEventListener('input', ()=>{ scheduleSave(); scheduleGoalDraftUpdate(); }));
  function updateObstacleOtherVisibility(){
    const otherField = document.getElementById('goal-obstacles-other');
    otherField.hidden = document.querySelector('input[name="primary-obstacle"]:checked')?.value !== 'obstacle-other';
  }
  updateObstacleOtherVisibility();
  document.querySelectorAll('input[name="primary-obstacle"]').forEach(field=>field.addEventListener('change', ()=>{ updateObstacleOtherVisibility(); scheduleSave(); scheduleGoalDraftUpdate(); }));
  document.querySelectorAll('input[name="available-time-mode"]').forEach(field=>field.addEventListener('change', scheduleSave));
  copyAnswersButton.addEventListener('click', copyGoalDraft);
  downloadAnswersButton.addEventListener('click', downloadAnswers);
  clearAnswersButton.addEventListener('click', clearAnswers);

  // ---- voluntary feedback: copy locally, then open an empty WhatsApp message ----
  document.getElementById('copy-feedback-answers').addEventListener('click', copyFeedbackAnswers);
  document.getElementById('feedback-cta').href = `https://wa.me/${CONFIG.whatsappNumber}`;

  // ---- optional author photo: reveal only after a successful load ----
  const authorPhoto = document.getElementById('author-photo');
  const showAuthorPhoto = ()=>{ authorPhoto.hidden = false; };
  if (authorPhoto.complete) {
    if (authorPhoto.naturalWidth > 0) showAuthorPhoto();
  } else {
    authorPhoto.addEventListener('load', showAuthorPhoto, { once:true });
  }

  // ---- program CTA ----
  document.getElementById('program-cta').href = CONFIG.programUrl;

  // ---- PDF download ----
  document.getElementById('pdf-download').href = CONFIG.pdfUrl;
