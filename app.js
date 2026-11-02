const PHASE_OPTIONS = ["A", "B", "C"];

const state = {
  supabase: null,
  user: null,
  round: null,
  groupSetting: null,
  studentSession: null,
  submissions: [],
  choices: {},
  plans: {}
};

document.addEventListener("DOMContentLoaded", () => {
  wireTabs();
  renderIndividualForm();
  bindEvents();
  boot().catch(showFatal);
});

function wireTabs() {
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab + "Tab").classList.add("active");
    });
  });
}

function bindEvents() {
  document.getElementById("teacherCreateForm").addEventListener("submit", createRound);
  document.getElementById("studentLinkForm").addEventListener("submit", linkStudentToRound);
  document.getElementById("saveIndividualButton").addEventListener("click", saveIndividualAnswers);
  document.getElementById("saveChoicesButton").addEventListener("click", saveGroupChoices);
  document.getElementById("savePlansButton").addEventListener("click", saveActionPlans);
  document.getElementById("refreshButton").addEventListener("click", refreshGroupData);
}

async function boot() {
  const banner = document.getElementById("statusBanner");
  const cfg = window.APP_CONFIG || {};

  if (!cfg.supabaseUrl || cfg.supabaseUrl.includes("PLAK_HIER")) {
    banner.className = "banner warning";
    banner.textContent = "Vul eerst config.js in met je Supabase URL en publishable key. Daarna werkt de app.";
    return;
  }

  state.supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  const authResult = await state.supabase.auth.signInAnonymously();
  if (authResult.error) throw authResult.error;
  state.user = authResult.data.user;

  banner.className = "banner success";
  banner.textContent = "Verbinding met Supabase is gelukt. Je kunt nu een ronde aanmaken of jezelf koppelen aan een ronde.";

  const saved = loadLocal("ontwikkelingsfasen_session");
  if (saved?.roundCode && saved?.groupNumber && saved?.initials) {
    document.getElementById("roundCodeInput").value = saved.roundCode;
    document.getElementById("groupInput").value = String(saved.groupNumber);
    document.getElementById("initialsInput").value = saved.initials;
    await restoreStudentSession(saved);
  }

  setInterval(() => {
    if (state.studentSession) refreshGroupData(false);
  }, (cfg.refreshIntervalMs || 10000));
}

async function createRound(event) {
  event.preventDefault();
  try {
    const roundCode = normalizeCode(document.getElementById("teacherRoundCode").value);
    const title = document.getElementById("teacherRoundTitle").value.trim();
    const note = document.getElementById("teacherNote").value.trim();
    const sizes = [1, 2, 3, 4, 5].map((groupNumber) => ({
      group_number: groupNumber,
      expected_students: Number(document.getElementById("groupSize" + groupNumber).value || 0)
    }));

    if (!roundCode || !title) throw new Error("Vul een rondecode en titel in.");
    if (sizes.some((item) => !item.expected_students || item.expected_students < 1)) {
      throw new Error("Vul per groep een geldig aantal studenten in.");
    }

    const { data: round, error: roundError } = await state.supabase
      .from("rounds")
      .insert({ code: roundCode, title, teacher_note: note })
      .select()
      .single();

    if (roundError) throw roundError;

    const rows = sizes.map((item) => ({
      round_id: round.id,
      group_number: item.group_number,
      expected_students: item.expected_students
    }));

    const { error: settingsError } = await state.supabase.from("group_settings").insert(rows);
    if (settingsError) throw settingsError;

    const box = document.getElementById("teacherResult");
    box.classList.remove("hidden");
    box.innerHTML = `
      <h3>Ronde aangemaakt</h3>
      <div class="kv"><strong>Rondecode</strong><span>${escapeHtml(roundCode)}</span></div>
      <div class="kv"><strong>Titel</strong><span>${escapeHtml(title)}</span></div>
      <p class="note">Geef deze rondecode aan studenten. Zij vullen daarna groep, beginletter(s) en hun antwoorden in.</p>
    `;
    event.target.reset();
  } catch (error) {
    alert(readError(error));
  }
}

async function linkStudentToRound(event) {
  event.preventDefault();
  try {
    const roundCode = normalizeCode(document.getElementById("roundCodeInput").value);
    const groupNumber = Number(document.getElementById("groupInput").value);
    const initials = document.getElementById("initialsInput").value.trim().toUpperCase();

    if (!roundCode || !groupNumber || !initials) throw new Error("Vul rondecode, groep en beginletter(s) in.");

    const { data: round, error: roundError } = await state.supabase
      .from("rounds")
      .select("*")
      .eq("code", roundCode)
      .single();

    if (roundError || !round) throw new Error("Deze rondecode bestaat niet.");

    const { data: groupSetting, error: settingError } = await state.supabase
      .from("group_settings")
      .select("*")
      .eq("round_id", round.id)
      .eq("group_number", groupNumber)
      .single();

    if (settingError || !groupSetting) throw new Error("Deze groep is niet ingesteld in de gekozen ronde.");

    state.round = round;
    state.groupSetting = groupSetting;
    state.studentSession = { roundCode, groupNumber, initials };
    saveLocal("ontwikkelingsfasen_session", state.studentSession);

    showStudentSession();
    document.getElementById("individualSection").classList.remove("hidden");

    await preloadExistingSubmission();
    await refreshGroupData();
  } catch (error) {
    alert(readError(error));
  }
}

async function restoreStudentSession(saved) {
  try {
    const { data: round } = await state.supabase.from("rounds").select("*").eq("code", saved.roundCode).single();
    if (!round) return;
    const { data: groupSetting } = await state.supabase
      .from("group_settings")
      .select("*")
      .eq("round_id", round.id)
      .eq("group_number", saved.groupNumber)
      .single();

    if (!groupSetting) return;

    state.round = round;
    state.groupSetting = groupSetting;
    state.studentSession = saved;
    showStudentSession();
    document.getElementById("individualSection").classList.remove("hidden");
    await preloadExistingSubmission();
    await refreshGroupData();
  } catch (error) {
    console.warn(error);
  }
}

function showStudentSession() {
  const card = document.getElementById("studentSessionCard");
  card.classList.remove("hidden");
  card.innerHTML = `
    <h3>Jouw sessie</h3>
    <div class="kv"><strong>Ronde</strong><span>${escapeHtml(state.round.code)} — ${escapeHtml(state.round.title)}</span></div>
    <div class="kv"><strong>Groep</strong><span>Groep ${state.studentSession.groupNumber}</span></div>
    <div class="kv"><strong>Beginletter(s)</strong><span>${escapeHtml(state.studentSession.initials)}</span></div>
  `;
}

function renderIndividualForm() {
  const form = document.getElementById("individualForm");
  form.innerHTML = window.APP_ASPECTS.map((aspect) => `
    <article class="aspect-card">
      <div class="aspect-header">
        <div>
          <h3>${aspect.id}. ${escapeHtml(aspect.title)}</h3>
          ${aspect.intro ? `<p class="small">${escapeHtml(aspect.intro)}</p>` : ""}
        </div>
      </div>
      <div class="phase-grid">
        <div class="phase-box">
          <h4>Waar zit jullie groep nu volgens jou?</h4>
          ${PHASE_OPTIONS.map((option) => `
            <label class="radio-line">
              <input type="radio" name="now_${aspect.key}" value="${option}" />
              <span><strong>${option}</strong> — ${escapeHtml(aspect.phases[option])}</span>
            </label>
          `).join("")}
        </div>
        <div class="phase-box">
          <h4>Waar wil jij individueel naartoe?</h4>
          ${PHASE_OPTIONS.map((option) => `
            <label class="radio-line">
              <input type="radio" name="target_${aspect.key}" value="${option}" />
              <span><strong>${option}</strong> — ${escapeHtml(aspect.phases[option])}</span>
            </label>
          `).join("")}
        </div>
        <div class="phase-box">
          <h4>Betekenis van A, B en C</h4>
          ${PHASE_OPTIONS.map((option) => `<p><strong>${option}</strong> — ${escapeHtml(aspect.phases[option])}</p>`).join("")}
        </div>
      </div>
    </article>
  `).join("");
}

async function preloadExistingSubmission() {
  const { data, error } = await state.supabase
    .from("student_submissions")
    .select("*")
    .eq("round_id", state.round.id)
    .eq("group_number", state.studentSession.groupNumber)
    .eq("initials", state.studentSession.initials)
    .maybeSingle();

  if (error) throw error;
  if (!data) return;

  for (const aspect of window.APP_ASPECTS) {
    const now = data.now_scores?.[aspect.key];
    const target = data.target_scores?.[aspect.key];
    if (now) {
      const nowInput = document.querySelector(`input[name="now_${aspect.key}"][value="${now}"]`);
      if (nowInput) nowInput.checked = true;
    }
    if (target) {
      const targetInput = document.querySelector(`input[name="target_${aspect.key}"][value="${target}"]`);
      if (targetInput) targetInput.checked = true;
    }
  }
}

async function saveIndividualAnswers() {
  try {
    ensureStudentLinked();

    const nowScores = {};
    const targetScores = {};
    for (const aspect of window.APP_ASPECTS) {
      const now = document.querySelector(`input[name="now_${aspect.key}"]:checked`)?.value;
      const target = document.querySelector(`input[name="target_${aspect.key}"]:checked`)?.value;
      if (!now || !target) throw new Error(`Vul bij "${aspect.title}" zowel nu als naartoe in.`);
      nowScores[aspect.key] = now;
      targetScores[aspect.key] = target;
    }

    const payload = {
      round_id: state.round.id,
      group_number: state.studentSession.groupNumber,
      initials: state.studentSession.initials,
      now_scores: nowScores,
      target_scores: targetScores
    };

    const { error } = await state.supabase
      .from("student_submissions")
      .upsert(payload, { onConflict: "round_id,group_number,initials" });

    if (error) throw error;

    alert("Jouw individuele antwoorden zijn opgeslagen.");
    await refreshGroupData();
  } catch (error) {
    alert(readError(error));
  }
}

async function refreshGroupData(showToast = true) {
  try {
    ensureStudentLinked();

    const [{ data: submissions, error: submissionsError }, { data: choices, error: choicesError }, { data: plans, error: plansError }] = await Promise.all([
      state.supabase
        .from("student_submissions")
        .select("*")
        .eq("round_id", state.round.id)
        .eq("group_number", state.studentSession.groupNumber)
        .order("initials"),
      state.supabase
        .from("group_choices")
        .select("*")
        .eq("round_id", state.round.id)
        .eq("group_number", state.studentSession.groupNumber),
      state.supabase
        .from("action_plans")
        .select("*")
        .eq("round_id", state.round.id)
        .eq("group_number", state.studentSession.groupNumber)
    ]);

    if (submissionsError) throw submissionsError;
    if (choicesError) throw choicesError;
    if (plansError) throw plansError;

    state.submissions = submissions || [];
    state.choices = Object.fromEntries((choices || []).map((row) => [row.aspect_key, row.chosen_option]));
    state.plans = Object.fromEntries((plans || []).map((row) => [row.aspect_key, row]));

    renderDashboard();
    renderGroupChoices();
    renderActionPlans();
    renderOutput();

    if (showToast) {
      const count = state.submissions.length;
      const needed = state.groupSetting.expected_students;
      const message = count >= needed
        ? `Gegevens ververst. Alle ${needed} groepsleden hebben ingevuld.`
        : `Gegevens ververst. ${count} van ${needed} groepsleden hebben ingevuld.`;
      console.log(message);
    }
  } catch (error) {
    alert(readError(error));
  }
}

function renderDashboard() {
  const needed = state.groupSetting.expected_students;
  const count = state.submissions.length;

  document.getElementById("dashboardSection").classList.remove("hidden");
  document.getElementById("completionPill").textContent = `${count} / ${needed} ingevuld`;

  const note = document.getElementById("roundNote");
  if (state.round.teacher_note) {
    note.classList.remove("hidden");
    note.textContent = `Notitie van docent: ${state.round.teacher_note}`;
  } else {
    note.classList.add("hidden");
  }

  const ready = count >= needed;
  document.getElementById("dashboardIntro").classList.toggle("hidden", !ready);
  document.getElementById("groupChoiceSection").classList.toggle("hidden", !ready);
  document.getElementById("actionPlanSection").classList.toggle("hidden", !ready);
  document.getElementById("outputSection").classList.toggle("hidden", !ready);

  if (!count) {
    document.getElementById("dashboardTableWrap").innerHTML = '<div class="banner info">Nog geen antwoorden van deze groep gevonden.</div>';
    return;
  }

  const headCells = state.submissions.map((submission) => `<th>${escapeHtml(submission.initials)}</th>`).join("");
  const rows = window.APP_ASPECTS.map((aspect) => {
    const studentCells = state.submissions.map((submission) => {
      const now = submission.now_scores?.[aspect.key] || "-";
      const target = submission.target_scores?.[aspect.key] || "-";
      return `<td><div><strong>Nu:</strong> ${now}</div><div><strong>Naar toe:</strong> ${target}</div></td>`;
    }).join("");
    return `<tr><th>${escapeHtml(aspect.title)}</th>${studentCells}</tr>`;
  }).join("");

  document.getElementById("dashboardTableWrap").innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Aspect</th>
          ${headCells}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderGroupChoices() {
  const wrap = document.getElementById("groupChoiceList");
  wrap.innerHTML = window.APP_ASPECTS.map((aspect) => `
    <div class="choice-row">
      <div>
        <h3>${aspect.id}. ${escapeHtml(aspect.title)}</h3>
        <p class="small">Kies nu als groep samen welke optie het beste past bij waar jullie naartoe willen.</p>
      </div>
      <div class="choice-options">
        ${PHASE_OPTIONS.map((option) => `
          <label>
            <input type="radio" name="choice_${aspect.key}" value="${option}" ${state.choices[aspect.key] === option ? "checked" : ""} />
            <span>${option}</span>
          </label>
        `).join("")}
      </div>
    </div>
  `).join("");
}

async function saveGroupChoices() {
  try {
    ensureStudentLinked();
    const rows = window.APP_ASPECTS.map((aspect) => {
      const chosen = document.querySelector(`input[name="choice_${aspect.key}"]:checked`)?.value;
      if (!chosen) throw new Error(`Kies bij "${aspect.title}" samen A, B of C.`);
      return {
        round_id: state.round.id,
        group_number: state.studentSession.groupNumber,
        aspect_key: aspect.key,
        chosen_option: chosen
      };
    });

    const { error } = await state.supabase.from("group_choices").upsert(rows, { onConflict: "round_id,group_number,aspect_key" });
    if (error) throw error;

    alert("De gezamenlijke keuzes zijn opgeslagen.");
    await refreshGroupData(false);
  } catch (error) {
    alert(readError(error));
  }
}

function renderActionPlans() {
  const wrap = document.getElementById("actionPlanList");
  wrap.innerHTML = window.APP_ASPECTS.map((aspect) => {
    const plan = state.plans[aspect.key] || {};
    const chosen = state.choices[aspect.key] || "Nog niet gekozen";
    return `
      <article class="aspect-card">
        <div class="aspect-header">
          <div>
            <h3>${aspect.id}. ${escapeHtml(aspect.title)}</h3>
            <p class="small">Gezamenlijke keuze: <strong>${escapeHtml(chosen)}</strong></p>
          </div>
        </div>
        <div class="grid two">
          <label>
            Wat gaan jullie doen of wat gaat er gebeuren?
            <textarea rows="3" data-plan="${aspect.key}" data-field="what_text">${escapeHtml(plan.what_text || "")}</textarea>
          </label>
          <label>
            Hoe gaan jullie het doen of hoe verloopt de taak?
            <textarea rows="3" data-plan="${aspect.key}" data-field="how_text">${escapeHtml(plan.how_text || "")}</textarea>
          </label>
          <label>
            Waar vindt het plaats?
            <textarea rows="2" data-plan="${aspect.key}" data-field="where_text">${escapeHtml(plan.where_text || "")}</textarea>
          </label>
          <label>
            Wanneer doen jullie het? Benoem duidelijke begin- en eindtijd.
            <textarea rows="2" data-plan="${aspect.key}" data-field="when_text">${escapeHtml(plan.when_text || "")}</textarea>
          </label>
          <label>
            Wie zet dit in het scrumbord?
            <input type="text" data-plan="${aspect.key}" data-field="scrum_owner" value="${escapeAttr(plan.scrum_owner || "")}" />
          </label>
          <label>
            Wie doen mee of met wie ben je?
            <input type="text" data-plan="${aspect.key}" data-field="who_text" value="${escapeAttr(plan.who_text || "")}" />
          </label>
        </div>
      </article>
    `;
  }).join("");
}

async function saveActionPlans() {
  try {
    ensureStudentLinked();

    const rows = window.APP_ASPECTS.map((aspect) => {
      const chosen = state.choices[aspect.key];
      if (!chosen) throw new Error(`Sla eerst bij "${aspect.title}" de gezamenlijke keuze op.`);
      const plan = collectPlan(aspect.key);

      const requiredFields = ["what_text", "how_text", "where_text", "when_text", "scrum_owner", "who_text"];
      for (const field of requiredFields) {
        if (!plan[field]) throw new Error(`Vul alle planvelden in bij "${aspect.title}".`);
      }

      return {
        round_id: state.round.id,
        group_number: state.studentSession.groupNumber,
        aspect_key: aspect.key,
        ...plan
      };
    });

    const { error } = await state.supabase.from("action_plans").upsert(rows, { onConflict: "round_id,group_number,aspect_key" });
    if (error) throw error;

    alert("De afspraken zijn opgeslagen.");
    await refreshGroupData(false);
  } catch (error) {
    alert(readError(error));
  }
}

function collectPlan(aspectKey) {
  const fields = Array.from(document.querySelectorAll(`[data-plan="${aspectKey}"]`));
  return Object.fromEntries(fields.map((field) => [field.dataset.field, field.value.trim()]));
}

function renderOutput() {
  const checklistBox = document.getElementById("checklistOutput");
  const scrumBox = document.getElementById("scrumOutput");

  const missingPlans = window.APP_ASPECTS.some((aspect) => !state.plans[aspect.key] || !state.choices[aspect.key]);
  if (missingPlans) {
    checklistBox.innerHTML = "<p>De checklist verschijnt zodra alle gezamenlijke keuzes en afspraken zijn ingevuld.</p>";
    scrumBox.innerHTML = "<p>Het scrumbord-overzicht verschijnt zodra alle gezamenlijke keuzes en afspraken zijn ingevuld.</p>";
    return;
  }

  const checklistItems = window.APP_ASPECTS.map((aspect) => {
    const plan = state.plans[aspect.key];
    const choice = state.choices[aspect.key];
    return `
      <li>
        <strong>${escapeHtml(aspect.title)} — keuze ${escapeHtml(choice)}</strong><br>
        Wat: ${escapeHtml(plan.what_text)}<br>
        Hoe: ${escapeHtml(plan.how_text)}<br>
        Waar: ${escapeHtml(plan.where_text)}<br>
        Wanneer: ${escapeHtml(plan.when_text)}<br>
        Wie doen mee: ${escapeHtml(plan.who_text)}
      </li>
    `;
  }).join("");

  const scrumItems = window.APP_ASPECTS.map((aspect) => {
    const plan = state.plans[aspect.key];
    return `
      <li>
        <strong>${escapeHtml(aspect.title)}</strong> — zet in scrumbord: ${escapeHtml(plan.what_text)}<br>
        Tijd: ${escapeHtml(plan.when_text)}<br>
        Verantwoordelijk voor scrumbord: ${escapeHtml(plan.scrum_owner)}
      </li>
    `;
  }).join("");

  checklistBox.innerHTML = `<ul>${checklistItems}</ul>`;
  scrumBox.innerHTML = `
    <div class="banner warning" style="margin-bottom:12px">
      Reminder: zet deze afspraken ook echt in het scrumbord.
    </div>
    <ul>${scrumItems}</ul>
  `;
}

function ensureStudentLinked() {
  if (!state.studentSession || !state.round || !state.groupSetting) {
    throw new Error("Koppel jezelf eerst aan een ronde.");
  }
}

function normalizeCode(value) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function loadLocal(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); }
  catch { return null; }
}

function saveLocal(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function readError(error) {
  return error?.message || "Er ging iets mis.";
}

function showFatal(error) {
  console.error(error);
  const banner = document.getElementById("statusBanner");
  banner.className = "banner danger";
  banner.textContent = readError(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
