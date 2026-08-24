const API_BASE_URL =
  window.location.port === "5500"
    ? "http://127.0.0.1:8000"
    : window.location.origin;


async function readJsonResponse(response) {
  const responseText = await response.text();

  if (!responseText) {
    throw new Error(
      "분석 서버가 일시적으로 응답하지 않았습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error(
      "분석 서버 응답을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}



const imageInput = document.getElementById(
  "imageInput"
);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const fileSelectButton = document.getElementById(
  "fileSelectButton"
);
const changeImageButton = document.getElementById(
  "changeImageButton"
);
const uploadPlaceholder = document.getElementById(
  "uploadPlaceholder"
);
const imagePreviewBox = document.getElementById(
  "imagePreviewBox"
);
const imagePreview = document.getElementById(
  "imagePreview"
);
const selectedFileName = document.getElementById(
  "selectedFileName"
);
const selectedFileSize = document.getElementById(
  "selectedFileSize"
);

const memoCandidateSection =
  document.getElementById("memoCandidateSection");

const memoCandidateList =
  document.getElementById("memoCandidateList");

let previewObjectUrl = null;

const analyzeButton = document.getElementById("analyzeButton");
const saveButton = document.getElementById("saveButton");
const refreshButton = document.getElementById("refreshButton");
const statusMessage = document.getElementById("statusMessage");
const warningBox = document.getElementById("warningBox");
const confirmationCheck = document.getElementById(
  "confirmationCheck"
);
const allDayCheck = document.getElementById("allDayCheck");
const startTimeLabel = document.getElementById(
  "startTimeLabel"
);
const endTimeLabel = document.getElementById(
  "endTimeLabel"
);
const scheduleList = document.getElementById("scheduleList");
const reminder = document.getElementById("reminder");
const calendarMonthLabel = document.getElementById(
  "calendarMonthLabel"
);
const calendarGrid = document.getElementById(
  "calendarGrid"
);
const previousMonthButton = document.getElementById(
  "previousMonthButton"
);
const nextMonthButton = document.getElementById(
  "nextMonthButton"
);
const todayButton = document.getElementById(
  "todayButton"
);
const selectedDateLabel = document.getElementById(
  "selectedDateLabel"
);
const selectedDateCount = document.getElementById(
  "selectedDateCount"
);
const calendarScheduleList = document.getElementById(
  "calendarScheduleList"
);

const imageInputTab =
  document.getElementById("imageInputTab");

const textInputTab =
  document.getElementById("textInputTab");

const imageInputPanel =
  document.getElementById("imageInputPanel");

const textInputPanel =
  document.getElementById("textInputPanel");  

const textAnalysisInput =
  document.getElementById("textAnalysisInput");  

const referenceYearInput =
  document.getElementById("referenceYearInput");  

const analyzeTextButton =
  document.getElementById("analyzeTextButton");  

let savedSchedules = [];

const SCHEDULE_STORAGE_KEY =
  "pickdam_schedules_v1";


function createScheduleId() {
  if (
    window.crypto &&
    typeof window.crypto.randomUUID === "function"
  ) {
    return window.crypto.randomUUID();
  }

  return [
    Date.now(),
    Math.random().toString(16).slice(2),
  ].join("-");
}


function readStoredSchedules() {
  const storedValue = window.localStorage.getItem(
    SCHEDULE_STORAGE_KEY
  );

  if (!storedValue) {
    return [];
  }

  let parsedValue;

  try {
    parsedValue = JSON.parse(storedValue);
  } catch (error) {
    throw new Error(
      "브라우저에 저장된 일정 데이터를 읽지 못했습니다."
    );
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(
      "브라우저의 일정 저장 형식이 올바르지 않습니다."
    );
  }

  return parsedValue;
}


function writeStoredSchedules(schedules) {
  try {
    window.localStorage.setItem(
      SCHEDULE_STORAGE_KEY,
      JSON.stringify(schedules)
    );
  } catch (error) {
    throw new Error(
      "브라우저에 일정을 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요."
    );
  }
}


function normalizeScheduleComparisonValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}


function hasDuplicateSchedule(schedule) {
  return savedSchedules.some((savedSchedule) => {
    return (
      normalizeScheduleComparisonValue(
        savedSchedule.title
      ) ===
        normalizeScheduleComparisonValue(schedule.title) &&
      savedSchedule.start_time === schedule.start_time &&
      normalizeScheduleComparisonValue(
        savedSchedule.location
      ) ===
        normalizeScheduleComparisonValue(schedule.location)
    );
  });
}


function escapeIcsText(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}


function foldIcsLine(line, maxBytes = 73) {
  const encoder = new TextEncoder();
  const parts = [];
  let current = "";

  for (const character of line) {
    const candidate = current + character;

    if (
      current &&
      encoder.encode(candidate).length > maxBytes
    ) {
      parts.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts.join("\r\n ");
}


function formatIcsDate(value) {
  return String(value ?? "")
    .slice(0, 10)
    .replaceAll("-", "");
}


function formatIcsDateTime(value) {
  const digits = String(value ?? "")
    .replace(/[^0-9]/g, "")
    .slice(0, 12);

  return `${digits.slice(0, 8)}T${digits.slice(8)}00`;
}


function addDaysToDate(value, days) {
  const [year, month, day] = String(value)
    .slice(0, 10)
    .split("-")
    .map(Number);

  const date = new Date(year, month - 1, day + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}


function downloadScheduleIcs(schedule) {
  const nowUtc = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Pickdam//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:schedule-${schedule.id}@pickdam.local`,
    `DTSTAMP:${nowUtc}`,
  ];

  if (schedule.all_day) {
    const startDate = String(schedule.start_time).slice(
      0,
      10
    );
    const lastDate = schedule.end_time
      ? String(schedule.end_time).slice(0, 10)
      : startDate;
    const exclusiveEndDate = addDaysToDate(
      lastDate,
      1
    );

    lines.push(
      `DTSTART;VALUE=DATE:${formatIcsDate(startDate)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(exclusiveEndDate)}`
    );
  } else {
    lines.push(
      `DTSTART;TZID=Asia/Seoul:${formatIcsDateTime(
        schedule.start_time
      )}`
    );

    if (schedule.end_time) {
      lines.push(
        `DTEND;TZID=Asia/Seoul:${formatIcsDateTime(
          schedule.end_time
        )}`
      );
    }
  }

  lines.push(
    `SUMMARY:${escapeIcsText(schedule.title)}`,
    `LOCATION:${escapeIcsText(schedule.location)}`,
    `DESCRIPTION:${escapeIcsText(schedule.memo)}`,
    "BEGIN:VALARM",
    `TRIGGER:-PT${Number(
      schedule.reminder_minutes
    )}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(schedule.title)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR"
  );

  const icsContent = `${lines
    .map((line) => foldIcsLine(line))
    .join("\r\n")}\r\n`;
  const blob = new Blob([icsContent], {
    type: "text/calendar;charset=utf-8",
  });
  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = downloadUrl;
  link.download = `schedule-${schedule.id}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(downloadUrl);
}

const now = new Date();

let calendarVisibleDate = new Date(
  now.getFullYear(),
  now.getMonth(),
  1
);

let calendarSelectedDate = new Date(
  now.getFullYear(),
  now.getMonth(),
  now.getDate()
);


const candidateSection = document.getElementById(
  "candidateSection"
);

const candidateList = document.getElementById(
  "candidateList"
);

let scheduleCandidates = [];
let selectedCandidateIndex = -1;
let selectedScheduleAllDay = false;


const fields = {
  title: document.getElementById("title"),
  startTime: document.getElementById("startTime"),
  endTime: document.getElementById("endTime"),
  location: document.getElementById("location"),
  memo: document.getElementById("memo"),
  ocrText: document.getElementById("ocrText"),
};

function formatDateOnly(value) {
  const dateText = String(value || "").slice(0, 10);
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return value || "미입력";
  }

  return `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.`;
}

function setAllDayMode(isAllDay, preserveValues = true) {
  const startValue = fields.startTime.value;
  const endValue = fields.endTime.value;

  selectedScheduleAllDay = Boolean(isAllDay);
  allDayCheck.checked = selectedScheduleAllDay;
  fields.startTime.type = selectedScheduleAllDay
    ? "date"
    : "datetime-local";
  fields.endTime.type = selectedScheduleAllDay
    ? "date"
    : "datetime-local";
  startTimeLabel.textContent = selectedScheduleAllDay
    ? "시작 날짜 (종일)"
    : "시작 날짜 및 시간";
  endTimeLabel.textContent = selectedScheduleAllDay
    ? "종료 날짜 (선택)"
    : "종료 날짜 및 시간";

  if (!preserveValues) {
    return;
  }

  fields.startTime.value = selectedScheduleAllDay
    ? startValue.slice(0, 10)
    : startValue && !startValue.includes("T")
      ? `${startValue}T00:00`
      : startValue;
  fields.endTime.value = selectedScheduleAllDay
    ? endValue.slice(0, 10)
    : endValue && !endValue.includes("T")
      ? `${endValue}T00:00`
      : endValue;
}

function setCandidateDateValues(candidate) {
  setAllDayMode(Boolean(candidate.all_day), false);
  fields.startTime.value = candidate.all_day
    ? String(candidate.start_time || "").slice(0, 10)
    : candidate.start_time ?? "";
  fields.endTime.value = candidate.all_day
    ? String(candidate.end_time || "").slice(0, 10)
    : candidate.end_time ?? "";
}

allDayCheck?.addEventListener("change", () => {
  setAllDayMode(allDayCheck.checked);
});

function clearValidation() {
  fields.title.classList.remove("invalid");
  fields.startTime.classList.remove("invalid");
  fields.endTime.classList.remove("invalid");
  fields.location.classList.remove("invalid");
}

function showWarnings(warnings) {
  if (!warnings || warnings.length === 0) {
    warningBox.hidden = true;
    warningBox.innerHTML = "";
    return;
  }

  warningBox.hidden = false;

  const heading = document.createElement("strong");
  heading.textContent = "확인이 필요한 항목";

  const list = document.createElement("ul");

  for (const warning of warnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    list.appendChild(item);
  }

  warningBox.replaceChildren(heading, list);
}

function validateSchedule() {
  clearValidation();

  const warnings = [];

  if (!fields.title.value.trim()) {
    warnings.push("일정 제목을 입력해 주세요.");
    fields.title.classList.add("invalid");
  }

  if (!fields.startTime.value) {
    warnings.push("시작 날짜 및 시간을 입력해 주세요.");
    fields.startTime.classList.add("invalid");
  }

  if (!fields.location.value.trim()) {
    warnings.push("장소가 없다면 '장소 없음'이라고 입력해 주세요.");
    fields.location.classList.add("invalid");
  }

  if (
    fields.startTime.value &&
    fields.endTime.value &&
    fields.endTime.value <= fields.startTime.value
  ) {
    warnings.push(
      "종료 날짜 및 시간은 시작 날짜 및 시간보다 늦어야 합니다."
    );
    fields.endTime.classList.add("invalid");
  }

  showWarnings(warnings);

  return warnings.length === 0;
}

function formatDateTime(value) {
  if (!value) {
    return "미입력";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatReminder(minutes) {
  const reminderMap = {
    10080: "7일 전",
    4320: "3일 전",
    1440: "1일 전",
    60: "1시간 전",
  };

  return reminderMap[minutes] ?? `${minutes}분 전`;
}

function createTextRow(label, value) {
  const paragraph = document.createElement("p");
  const strong = document.createElement("strong");

  strong.textContent = `${label}: `;
  paragraph.appendChild(strong);
  paragraph.appendChild(document.createTextNode(value));

  return paragraph;
}


async function deleteSchedule(scheduleId) {
  const confirmed = window.confirm(
    "이 일정을 삭제하시겠습니까?"
  );

  if (!confirmed) {
    return;
  }

  try {
    const remainingSchedules = savedSchedules.filter(
      (schedule) => String(schedule.id) !== String(scheduleId)
    );

    if (remainingSchedules.length === savedSchedules.length) {
      throw new Error("삭제할 일정을 찾지 못했습니다.");
    }

    writeStoredSchedules(remainingSchedules);
    statusMessage.textContent = "일정이 삭제되었습니다.";
    await loadSchedules();
  } catch (error) {
    statusMessage.textContent = `오류: ${error.message}`;
  }
}

function renderSchedules(schedules) {
  scheduleList.replaceChildren();

  if (schedules.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent =
      "아직 저장된 일정이 없습니다.";

    scheduleList.appendChild(emptyMessage);
    return;
  }

  for (const schedule of schedules) {
    const article = document.createElement("article");
    article.className = "schedule-item";

    const title = document.createElement("h3");
    title.textContent = schedule.title;

    article.appendChild(title);

    article.appendChild(
      createTextRow(
        schedule.all_day ? "일정" : "시작",
        schedule.all_day
          ? `${formatDateOnly(schedule.start_time)} · 종일`
          : formatDateTime(schedule.start_time)
      )
    );

    if (!schedule.all_day || schedule.end_time) {
      article.appendChild(
        createTextRow(
          schedule.all_day ? "종료 날짜" : "종료",
          schedule.all_day
            ? formatDateOnly(schedule.end_time)
            : formatDateTime(schedule.end_time)
        )
      );
    }

    article.appendChild(
      createTextRow(
        "장소",
        schedule.location
      )
    );

    article.appendChild(
      createTextRow(
        "알림",
        formatReminder(schedule.reminder_minutes)
      )
    );

    if (schedule.memo) {
      article.appendChild(
        createTextRow(
          "메모",
          schedule.memo
        )
      );
    }

    const actions = document.createElement("div");
    actions.className = "schedule-actions";


    const calendarButton =
      document.createElement("button");

    calendarButton.type = "button";
    calendarButton.className =
      "calendar-button";
    calendarButton.textContent =
      "캘린더 파일 받기";

    calendarButton.addEventListener("click", () => {
      downloadScheduleIcs(schedule);
    });

    const deleteButton =
      document.createElement("button");

    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "삭제";

    deleteButton.addEventListener("click", () => {
      deleteSchedule(schedule.id);
    });

    actions.append(
      calendarButton,
      deleteButton
    );

    article.appendChild(actions);
    scheduleList.appendChild(article);
  }
}


function getCandidateDateParts(value) {
  if (!value) {
    return {
      day: "--",
      month: "날짜 없음",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      day: "--",
      month: "확인 필요",
    };
  }

  return {
    day: String(date.getDate()),
    month: `${date.getMonth() + 1}월`,
  };
}


function selectCandidate(index) {
  const candidate = scheduleCandidates[index];

  if (!candidate) {
    return;
  }

  selectedCandidateIndex = index;

  fields.title.value = candidate.title ?? "";
  setCandidateDateValues(candidate);
  fields.location.value =
    candidate.location || "장소 없음";
  fields.memo.value = candidate.memo ?? "";

  confirmationCheck.checked = false;
  clearValidation();
  showWarnings(candidate.warnings ?? []);

  if (candidateList) {
    const cards = candidateList.querySelectorAll(
      ".candidate-card"
    );

    cards.forEach((card, cardIndex) => {
      card.classList.toggle(
        "selected",
        cardIndex === index
      );
    });
  }

  document.querySelector(".result-card")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}


function renderScheduleCandidates(candidates) {
  scheduleCandidates = Array.isArray(candidates)
    ? candidates
    : [];

  if (!candidateSection || !candidateList) {
    return;
  }

  candidateList.replaceChildren();

  if (scheduleCandidates.length <= 1) {
    candidateSection.hidden = true;

    selectedCandidateIndex =
      scheduleCandidates.length === 1 ? 0 : -1;

    if (scheduleCandidates.length === 1) {
      selectCandidate(0);
    }

    return;
  }

  candidateSection.hidden = false;

  scheduleCandidates.forEach((candidate, index) => {
    const button =
      document.createElement("button");

    button.type = "button";
    button.className = "candidate-card";

    const dateParts = getCandidateDateParts(
      candidate.start_time
    );

    const dateBox =
      document.createElement("span");

    dateBox.className = "candidate-date";

    const day = document.createElement("strong");
    day.textContent = dateParts.day;

    const month = document.createElement("span");
    month.textContent = dateParts.month;

    dateBox.append(day, month);

    const content =
      document.createElement("span");

    content.className = "candidate-content";

    const title =
      document.createElement("strong");

    title.textContent =
      candidate.title || "제목 확인 필요";

    const meta = document.createElement("span");
    meta.className = "candidate-meta";

    meta.textContent = candidate.all_day
      ? `${formatDateOnly(candidate.start_time)} · 종일 일정`
      : formatDateTime(candidate.start_time);

    const badges =
      document.createElement("span");

    badges.className = "candidate-badges";

    const typeBadge =
      document.createElement("span");

    typeBadge.className = "candidate-badge";

    const eventNames = {
      application_start: "접수 시작",
      application_deadline: "접수 마감",
      document_review: "서면 심사",
      announcement: "발표·시상",
      general: "일반 일정",
    };

    typeBadge.textContent =
      eventNames[candidate.event_type] || "일정";

    badges.appendChild(typeBadge);

    if (
      candidate.needs_confirmation ||
      (candidate.warnings &&
        candidate.warnings.length > 0)
    ) {
      const warningBadge =
        document.createElement("span");

      warningBadge.className =
        "candidate-badge warning";

      warningBadge.textContent =
        "원문 확인 필요";

      badges.appendChild(warningBadge);
    }

    content.append(title, meta, badges);
    button.append(dateBox, content);

    button.addEventListener("click", () => {
      selectCandidate(index);
    });

    candidateList.appendChild(button);
  });

  selectCandidate(0);
}


async function loadSchedules() {
  scheduleList.textContent = "저장된 일정을 불러오는 중입니다.";

  try {
    savedSchedules = readStoredSchedules()
      .slice()
      .sort((first, second) => {
        return String(first.start_time).localeCompare(
          String(second.start_time)
        );
      });

    renderSchedules(savedSchedules);
    renderCalendar();
  } catch (error) {
    scheduleList.textContent = `오류: ${error.message}`;
  }
}

function toDateKey(value) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");
  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}


function getSchedulesForDate(date) {
  const dateKey = toDateKey(date);

  return savedSchedules.filter((schedule) => {
    return toDateKey(schedule.start_time) === dateKey;
  });
}


function formatCalendarTime(value) {
  if (!value) {
    return "시간 미입력";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}


function renderSelectedDateSchedules() {
  if (
    !selectedDateLabel ||
    !selectedDateCount ||
    !calendarScheduleList
  ) {
    return;
  }

  const schedules = getSchedulesForDate(
    calendarSelectedDate
  );

  selectedDateLabel.textContent =
    new Intl.DateTimeFormat("ko-KR", {
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(calendarSelectedDate);

  selectedDateCount.textContent =
    `${schedules.length}개`;

  calendarScheduleList.replaceChildren();

  if (schedules.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.className = "empty-message";
    emptyMessage.textContent =
      "이 날짜에 저장된 일정이 없습니다.";

    calendarScheduleList.appendChild(emptyMessage);
    return;
  }

  schedules
    .slice()
    .sort((first, second) => {
      return new Date(first.start_time) -
        new Date(second.start_time);
    })
    .forEach((schedule) => {
      const article = document.createElement("article");
      article.className = "calendar-schedule-item";

      const time = document.createElement("span");
      time.className = "calendar-schedule-time";
      time.textContent = schedule.all_day
        ? "종일"
        : formatCalendarTime(schedule.start_time);

      const title = document.createElement("h3");
      title.textContent = schedule.title;

      article.append(time, title);

      if (schedule.location) {
        const location = document.createElement("p");
        location.textContent =
          `장소: ${schedule.location}`;
        article.appendChild(location);
      }

      const actions = document.createElement("div");
      actions.className = "calendar-schedule-actions";

      const downloadButton =
        document.createElement("button");

      downloadButton.type = "button";
      downloadButton.className =
        "calendar-schedule-download";
      downloadButton.textContent = "ICS 받기";

      downloadButton.addEventListener("click", () => {
        downloadScheduleIcs(schedule);
      });

      const deleteButton =
        document.createElement("button");

      deleteButton.type = "button";
      deleteButton.className =
        "calendar-schedule-delete";
      deleteButton.textContent = "삭제";

      deleteButton.addEventListener("click", async () => {
        await deleteSchedule(schedule.id);
      });

      actions.append(
        downloadButton,
        deleteButton
      );

      article.appendChild(actions);
      calendarScheduleList.appendChild(article);
    });
}


function renderCalendar() {
  if (!calendarGrid || !calendarMonthLabel) {
    return;
  }

  const year = calendarVisibleDate.getFullYear();
  const month = calendarVisibleDate.getMonth();

  calendarMonthLabel.textContent =
    `${year}년 ${month + 1}월`;

  calendarGrid.replaceChildren();

  const firstDay = new Date(year, month, 1);
  const gridStart = new Date(
    year,
    month,
    1 - firstDay.getDay()
  );

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + index
    );

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";

    if (date.getMonth() !== month) {
      button.classList.add("outside-month");
    }

    if (date.getDay() === 0) {
      button.classList.add("sunday");
    }

    if (date.getDay() === 6) {
      button.classList.add("saturday");
    }

    if (toDateKey(date) === toDateKey(now)) {
      button.classList.add("today");
    }

    if (
      toDateKey(date) ===
      toDateKey(calendarSelectedDate)
    ) {
      button.classList.add("selected");
    }

    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(date.getDate());

    const indicator = document.createElement("span");
    indicator.className = "calendar-event-indicator";

    const daySchedules = getSchedulesForDate(date);
    const shownDotCount = Math.min(
      daySchedules.length,
      3
    );

    for (
      let dotIndex = 0;
      dotIndex < shownDotCount;
      dotIndex += 1
    ) {
      const dot = document.createElement("span");
      dot.className = "calendar-event-dot";
      indicator.appendChild(dot);
    }

    if (daySchedules.length > 3) {
      const more = document.createElement("span");
      more.className = "calendar-event-more";
      more.textContent = "+";
      indicator.appendChild(more);
    }

    button.append(dayNumber, indicator);

    button.setAttribute(
      "aria-label",
      `${date.getFullYear()}년 ${
        date.getMonth() + 1
      }월 ${date.getDate()}일, 일정 ${
        daySchedules.length
      }개`
    );

    button.addEventListener("click", () => {
      calendarSelectedDate = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate()
      );

      if (date.getMonth() !== month) {
        calendarVisibleDate = new Date(
          date.getFullYear(),
          date.getMonth(),
          1
        );
      }

      renderCalendar();
    });

    calendarGrid.appendChild(button);
  }

  renderSelectedDateSchedules();
}


function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "파일 크기 확인 불가";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function openImagePicker() {
  if (!imageInput) {
    statusMessage.textContent =
      "파일 입력 요소를 찾지 못했습니다.";

    return;
  }

  imageInput.click();
}


function updateImagePreview() {
  const imageFile = imageInput?.files?.[0];

  if (!imageFile) {
    return;
  }

  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
  ];

  if (!allowedTypes.includes(imageFile.type)) {
    imageInput.value = "";
    uploadPlaceholder.hidden = false;
    imagePreviewBox.hidden = true;

    statusMessage.textContent =
      "PNG 또는 JPG 이미지 파일을 선택해 주세요.";

    return;
  }

  if (imageFile.size > MAX_IMAGE_BYTES) {
    imageInput.value = "";
    uploadPlaceholder.hidden = false;
    imagePreviewBox.hidden = true;

    statusMessage.textContent =
      "이미지 크기는 10MB 이하여야 합니다.";

    return;
  }

  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = URL.createObjectURL(imageFile);

  imagePreview.src = previewObjectUrl;
  selectedFileName.textContent = imageFile.name;
  selectedFileSize.textContent = formatFileSize(
    imageFile.size
  );

  uploadPlaceholder.hidden = true;
  imagePreviewBox.hidden = false;

  statusMessage.textContent =
    `${imageFile.name} 파일을 선택했습니다.`;
}


if (imageInput) {
  imageInput.addEventListener(
    "change",
    updateImagePreview
  );
}

if (fileSelectButton) {
  fileSelectButton.addEventListener(
    "click",
    openImagePicker
  );
}

if (changeImageButton) {
  changeImageButton.addEventListener(
    "click",
    openImagePicker
  );
}

async function saveAnalysisMemo(memo, button) {
  if (memo.is_sensitive) {
    const confirmed = window.confirm(
      "민감정보가 포함되어 있을 수 있습니다.\n" +
      "원문 그대로 메모장에 저장하시겠습니까?"
    );

    if (!confirmed) {
      return;
    }
  }

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "저장 중...";

  try {
    const memoData = {
      title: memo.title || "중요 메모",
      content: memo.content || "",
      memo_type: memo.memo_type || "general",
      is_sensitive: Boolean(memo.is_sensitive),
      is_pinned: false,
    };

    if (hasDuplicateMemo(memoData)) {
      throw new Error(
        "같은 제목과 내용의 메모가 이미 저장되어 있습니다."
      );
    }

    const now = new Date().toISOString();
    const storedMemo = {
      id: createMemoId(),
      ...memoData,
      created_at: now,
      updated_at: now,
    };

    writeStoredMemos([
      ...savedMemos,
      storedMemo,
    ]);

    button.textContent = "저장 완료";
    button.classList.add("saved");
    button.disabled = true;

    if (memoEditorStatus) {
      memoEditorStatus.textContent =
        "메모가 저장되었습니다.";
    }

    await loadMemos(
      memoSearchInput?.value.trim() || ""
    );
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;

    statusMessage.textContent =
      `오류: ${error.message}`;
  }
}


function renderMemoCandidates(memos) {
  if (!memoCandidateSection || !memoCandidateList) {
    return;
  }

  memoCandidateList.replaceChildren();

  if (!Array.isArray(memos) || memos.length === 0) {
    memoCandidateSection.hidden = true;
    return;
  }

  memos.forEach((memo) => {
    const article = document.createElement("article");
    article.className = "memo-candidate-item";

    if (memo.is_sensitive) {
      article.classList.add("sensitive");
    }

    const heading = document.createElement("div");
    heading.className = "memo-candidate-heading";

    const title = document.createElement("h3");
    title.textContent = memo.title || "중요 메모";

    const badge = document.createElement("span");
    badge.className = "memo-type-badge";

    if (memo.is_sensitive) {
      badge.classList.add("memo-sensitive-badge");
      badge.textContent = "민감정보 확인";
    } else {
      badge.textContent = "중요 메모";
    }

    heading.append(title, badge);

    const content = document.createElement("p");
    content.className = "memo-candidate-content";
    content.textContent = memo.content || "";

    article.append(heading, content);

    if (
      Array.isArray(memo.warnings) &&
      memo.warnings.length > 0
    ) {
      const warning = document.createElement("p");
      warning.className = "memo-candidate-warning";
      warning.textContent = memo.warnings.join(" ");
      article.appendChild(warning);
    }

      const saveButton = document.createElement("button");
      saveButton.type = "button";
      saveButton.className = "memo-candidate-save-button";
      saveButton.textContent = "메모장에 저장";

      saveButton.addEventListener("click", async () => {
        await saveAnalysisMemo(memo, saveButton);
      });

      article.appendChild(saveButton);


    memoCandidateList.appendChild(article);
  });

  memoCandidateSection.hidden = false;
}


function applyAnalysisResult(result, sourceLabel) {
  fields.ocrText.value = result.ocr_text ?? "";

  renderMemoCandidates(result.important_memos ?? []);

  const returnedCandidates =
    Array.isArray(result.schedules) &&
    result.schedules.length > 0
      ? result.schedules
      : [
          {
            title: result.title ?? "",
            start_time: result.start_time ?? "",
            end_time: result.end_time ?? "",
            location: result.location ?? "",
            memo: result.memo ?? "",
            warnings: result.warnings ?? [],
            event_type: "general",
            all_day: false,
          },
        ];

  if (
    candidateSection &&
    candidateList &&
    typeof renderScheduleCandidates === "function"
  ) {
    renderScheduleCandidates(returnedCandidates);
  } else {
    scheduleCandidates = returnedCandidates;
    selectedCandidateIndex = 0;

    const firstCandidate = returnedCandidates[0];

    fields.title.value = firstCandidate.title ?? "";
    setCandidateDateValues(firstCandidate);
    fields.location.value =
      firstCandidate.location || "장소 없음";
    fields.memo.value = firstCandidate.memo ?? "";

    showWarnings(firstCandidate.warnings ?? []);
  }

  statusMessage.textContent =
    returnedCandidates.length > 1
      ? `${sourceLabel}에서 일정 후보 ${returnedCandidates.length}개를 찾았습니다.`
      : `${sourceLabel}에서 일정 정보를 추출했습니다.`;

  document.querySelector(".result-card")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}


analyzeButton.addEventListener("click", async () => {
  const imageFile = imageInput.files[0];

  if (!imageFile) {
    statusMessage.textContent =
      "먼저 안내문 이미지를 선택해 주세요.";
    return;
  }

  if (imageFile.size > MAX_IMAGE_BYTES) {
    statusMessage.textContent =
      "이미지 크기는 10MB 이하여야 합니다.";
    return;
  }

  const formData = new FormData();
  formData.append("image", imageFile);

  analyzeButton.disabled = true;
  setAllDayMode(false);
  confirmationCheck.checked = false;
  clearValidation();
  renderMemoCandidates([]);

  statusMessage.textContent =
    "이미지에서 일정 정보를 추출하고 있습니다.";

  try {
    const response = await fetch(
      `${API_BASE_URL}/analyze`,
      {
        method: "POST",
        body: formData,
      }
    );

    const result = await readJsonResponse(response);

    if (!response.ok) {
      throw new Error(
        result.detail ||
          "이미지 분석 요청에 실패했습니다."
      );
    }

    applyAnalysisResult(
      result,
      result.filename || "선택한 이미지"
    );
  } catch (error) {
    showWarnings([]);
    statusMessage.textContent =
      `오류: ${error.message}`;
  } finally {
    analyzeButton.disabled = false;
  }
});

analyzeTextButton?.addEventListener(
  "click",
  async () => {
    const text =
      textAnalysisInput?.value.trim() || "";

    if (!text) {
      statusMessage.textContent =
        "분석할 안내문 텍스트를 입력해 주세요.";
      textAnalysisInput?.focus();
      return;
    }

    const yearValue =
      referenceYearInput?.value.trim() || "";

    const requestBody = {
      text,
      reference_year: yearValue
        ? Number(yearValue)
        : null,
    };

    analyzeTextButton.disabled = true;
    setAllDayMode(false);
    confirmationCheck.checked = false;
    clearValidation();
    renderMemoCandidates([]);

    analyzeTextButton.textContent =
      "텍스트 분석 중...";

    statusMessage.textContent =
      "텍스트에서 일정 정보를 추출하고 있습니다.";

    try {
      const response = await fetch(
        `${API_BASE_URL}/analyze-text`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        }
      );

      const result = await readJsonResponse(response);

      if (!response.ok) {
        throw new Error(
          result.detail ||
            "텍스트 분석 요청에 실패했습니다."
        );
      }

      applyAnalysisResult(
        result,
        "입력한 텍스트"
      );
    } catch (error) {
      showWarnings([]);
      statusMessage.textContent =
        `오류: ${error.message}`;
    } finally {
      analyzeTextButton.disabled = false;
      analyzeTextButton.textContent =
        "✦ 텍스트 분석하기";
    }
  }
);


saveButton.addEventListener("click", async () => {
  const isValid = validateSchedule();

  if (!isValid) {
    statusMessage.textContent =
      "빨간색으로 표시된 필수 정보를 확인해 주세요.";
    return;
  }

  if (!confirmationCheck.checked) {
    showWarnings([
      "이미지 원문과 추출 결과를 확인한 후 확인란을 체크해 주세요.",
    ]);
    statusMessage.textContent = "사용자 확인이 필요합니다.";
    return;
  }

  const scheduleData = {
    title: fields.title.value.trim(),
    start_time: selectedScheduleAllDay
      ? `${fields.startTime.value}T00:00`
      : fields.startTime.value,
    end_time: fields.endTime.value
      ? selectedScheduleAllDay
        ? `${fields.endTime.value}T00:00`
        : fields.endTime.value
      : null,
    location: fields.location.value.trim(),
    memo: fields.memo.value.trim(),
    reminder_minutes: Number(reminder.value),
    all_day: selectedScheduleAllDay,
  };

  saveButton.disabled = true;
  statusMessage.textContent = "일정을 저장하고 있습니다.";

  try {
    if (hasDuplicateSchedule(scheduleData)) {
      throw new Error(
        "같은 제목, 시작 시간, 장소의 일정이 이미 저장되어 있습니다."
      );
    }

    const storedSchedule = {
      id: createScheduleId(),
      ...scheduleData,
      created_at: new Date().toISOString(),
    };

    writeStoredSchedules([
      ...savedSchedules,
      storedSchedule,
    ]);

    showWarnings([]);
    confirmationCheck.checked = false;

    if (selectedCandidateIndex >= 0) {
      const selectedCandidate =
        scheduleCandidates[selectedCandidateIndex];

      selectedCandidate.saved = true;

      const selectedCard =
        candidateList.children[selectedCandidateIndex];

      if (selectedCard) {
        selectedCard.classList.add("saved");

        const badges = selectedCard.querySelector(
          ".candidate-badges"
        );

        if (
          badges &&
          !badges.querySelector(".candidate-badge.saved")
        ) {
          const savedBadge =
            document.createElement("span");

          savedBadge.className =
            "candidate-badge saved";
          savedBadge.textContent = "저장 완료";
          badges.appendChild(savedBadge);
        }
      }
    }

    statusMessage.textContent = "일정이 저장되었습니다.";

    await loadSchedules();

  } catch (error) {
    statusMessage.textContent = `오류: ${error.message}`;
  } finally {
    saveButton.disabled = false;
  }
});

refreshButton.addEventListener("click", loadSchedules);


async function initializePage() {
  await Promise.all([
    loadSchedules(),
    loadMemos(),
  ]);
}

const appPages = document.querySelectorAll(
  ".app-page"
);

const pageMoveButtons = document.querySelectorAll(
  "[data-target-page]"
);

const currentPageLabel = document.getElementById(
  "currentPageLabel"
);

const editingMemoId =
  document.getElementById("editingMemoId");
const memoEditorHeading =
  document.getElementById("memoEditorHeading");
const memoTitleInput =
  document.getElementById("memoTitleInput");
const memoContentInput =
  document.getElementById("memoContentInput");
const memoTypeInput =
  document.getElementById("memoTypeInput");
const memoPinnedInput =
  document.getElementById("memoPinnedInput");
const memoSensitiveInput =
  document.getElementById("memoSensitiveInput");
const memoEditorStatus =
  document.getElementById("memoEditorStatus");
const cancelMemoEditButton =
  document.getElementById("cancelMemoEditButton");
const saveMemoButton =
  document.getElementById("saveMemoButton");
const memoCountBadge =
  document.getElementById("memoCountBadge");
const memoSearchInput =
  document.getElementById("memoSearchInput");
const memoSearchButton =
  document.getElementById("memoSearchButton");
const clearMemoSearchButton =
  document.getElementById("clearMemoSearchButton");
const memoList =
  document.getElementById("memoList");

let savedMemos = [];

const MEMO_STORAGE_KEY = "pickdam_memos_v1";


function createMemoId() {
  return createScheduleId();
}


function readStoredMemos() {
  const storedValue = window.localStorage.getItem(
    MEMO_STORAGE_KEY
  );

  if (!storedValue) {
    return [];
  }

  let parsedValue;

  try {
    parsedValue = JSON.parse(storedValue);
  } catch (error) {
    throw new Error(
      "브라우저에 저장된 메모 데이터를 읽지 못했습니다."
    );
  }

  if (!Array.isArray(parsedValue)) {
    throw new Error(
      "브라우저의 메모 저장 형식이 올바르지 않습니다."
    );
  }

  return parsedValue;
}


function writeStoredMemos(memos) {
  try {
    window.localStorage.setItem(
      MEMO_STORAGE_KEY,
      JSON.stringify(memos)
    );
  } catch (error) {
    throw new Error(
      "브라우저에 메모를 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인해 주세요."
    );
  }
}


function normalizeMemoComparisonValue(value) {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("ko-KR");
}


function hasDuplicateMemo(memo) {
  return savedMemos.some((savedMemo) => {
    return (
      normalizeMemoComparisonValue(savedMemo.title) ===
        normalizeMemoComparisonValue(memo.title) &&
      normalizeMemoComparisonValue(savedMemo.content) ===
        normalizeMemoComparisonValue(memo.content)
    );
  });
}


function sortStoredMemos(memos) {
  return memos.slice().sort((first, second) => {
    const pinnedDifference =
      Number(Boolean(second.is_pinned)) -
      Number(Boolean(first.is_pinned));

    if (pinnedDifference !== 0) {
      return pinnedDifference;
    }

    return String(second.updated_at).localeCompare(
      String(first.updated_at)
    );
  });
}


const pageLabels = {
  memo: "내 메모",
  analyze: "정보 분석",
  calendar: "내 캘린더",
};


function showAppPage(pageName) {
  const targetPage = document.querySelector(
    `.app-page[data-page="${pageName}"]`
  );

  if (!targetPage) {
    return;
  }

  appPages.forEach((page) => {
    const isTarget =
      page.dataset.page === pageName;

    page.hidden = !isTarget;
    page.classList.toggle("active", isTarget);
  });

  document
    .querySelectorAll(".mobile-nav-button")
    .forEach((button) => {
      const isActive =
        button.dataset.targetPage === pageName;

      button.classList.toggle("active", isActive);

      if (isActive) {
        button.setAttribute(
          "aria-current",
          "page"
        );
      } else {
        button.removeAttribute("aria-current");
      }
    });

  if (currentPageLabel) {
    currentPageLabel.textContent =
      pageLabels[pageName] || "AI 일정 도우미";
  }

  window.scrollTo({
    top: 0,
    behavior: "smooth",
  });

  window.location.hash = pageName;
}


pageMoveButtons.forEach((button) => {
  button.addEventListener("click", () => {
    showAppPage(button.dataset.targetPage);
  });
});


function getInitialPage() {
  const hashPage = window.location.hash.replace(
    "#",
    ""
  );

  if (
    hashPage === "memo" ||
    hashPage === "calendar" ||
    hashPage === "analyze"
  ) {
    return hashPage;
  }

  return "analyze";
}


showAppPage(getInitialPage());

const appPageOrder = [
  "memo",
  "analyze",
  "calendar",
];

let touchStartX = 0;
let touchStartY = 0;
let touchEndX = 0;
let touchEndY = 0;
let touchStartedOnControl = false;


function isInteractiveElement(element) {
  return Boolean(
    element.closest(
      [
        "button",
        "input",
        "textarea",
        "select",
        "a",
        "summary",
        "label",
      ].join(",")
    )
  );
}


function getCurrentPageName() {
  const activePage = document.querySelector(
    ".app-page.active"
  );

  return activePage?.dataset.page || "analyze";
}


function handleSwipeGesture() {
  if (touchStartedOnControl) {
    return;
  }

  const horizontalDistance =
    touchEndX - touchStartX;

  const verticalDistance =
    touchEndY - touchStartY;

  const absoluteHorizontalDistance =
    Math.abs(horizontalDistance);

  const absoluteVerticalDistance =
    Math.abs(verticalDistance);

  if (absoluteHorizontalDistance < 70) {
    return;
  }

  if (
    absoluteHorizontalDistance <=
    absoluteVerticalDistance
  ) {
    return;
  }

  const currentPageName = getCurrentPageName();

  const currentIndex =
    appPageOrder.indexOf(currentPageName);

  if (currentIndex < 0) {
    return;
  }

  const nextIndex =
    horizontalDistance < 0
      ? currentIndex + 1
      : currentIndex - 1;

  if (
    nextIndex < 0 ||
    nextIndex >= appPageOrder.length
  ) {
    return;
  }

  showAppPage(appPageOrder[nextIndex]);
}


document.addEventListener(
  "touchstart",
  (event) => {
    if (event.touches.length !== 1) {
      touchStartedOnControl = true;
      return;
    }

    const target = event.target;

    touchStartedOnControl =
      isInteractiveElement(target);

    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
    touchEndX = touchStartX;
    touchEndY = touchStartY;
  },
  {
    passive: true,
  }
);


document.addEventListener(
  "touchmove",
  (event) => {
    if (
      touchStartedOnControl ||
      event.touches.length !== 1
    ) {
      return;
    }

    touchEndX = event.touches[0].clientX;
    touchEndY = event.touches[0].clientY;
  },
  {
    passive: true,
  }
);


document.addEventListener(
  "touchend",
  () => {
    handleSwipeGesture();

    touchStartX = 0;
    touchStartY = 0;
    touchEndX = 0;
    touchEndY = 0;
    touchStartedOnControl = false;
  },
  {
    passive: true,
  }
);

previousMonthButton?.addEventListener(
  "click",
  () => {
    calendarVisibleDate = new Date(
      calendarVisibleDate.getFullYear(),
      calendarVisibleDate.getMonth() - 1,
      1
    );

    renderCalendar();
  }
);


nextMonthButton?.addEventListener(
  "click",
  () => {
    calendarVisibleDate = new Date(
      calendarVisibleDate.getFullYear(),
      calendarVisibleDate.getMonth() + 1,
      1
    );

    renderCalendar();
  }
);


todayButton?.addEventListener(
  "click",
  () => {
    const today = new Date();

    calendarSelectedDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    calendarVisibleDate = new Date(
      today.getFullYear(),
      today.getMonth(),
      1
    );

    renderCalendar();
  }
);

function selectAnalysisInputMode(mode) {
  const useText = mode === "text";

  imageInputTab?.classList.toggle(
    "active",
    !useText
  );

  textInputTab?.classList.toggle(
    "active",
    useText
  );

  imageInputTab?.setAttribute(
    "aria-selected",
    String(!useText)
  );

  textInputTab?.setAttribute(
    "aria-selected",
    String(useText)
  );

  if (imageInputPanel) {
    imageInputPanel.hidden = useText;
  }

  if (textInputPanel) {
    textInputPanel.hidden = !useText;
  }
}


imageInputTab?.addEventListener("click", () => {
  selectAnalysisInputMode("image");
});


textInputTab?.addEventListener("click", () => {
  selectAnalysisInputMode("text");
  textAnalysisInput?.focus();
});


function formatMemoDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}


function getMemoTypeLabel(type) {
  const labels = {
    general: "일반",
    preparation: "준비물",
    application: "신청 및 접수",
    contact: "문의처",
    account: "계정 정보",
    payment: "결제 및 입금",
    visit: "방문 안내",
    sensitive: "민감정보",
  };

  return labels[type] || "일반";
}


function resetMemoEditor() {
  if (!editingMemoId) {
    return;
  }

  editingMemoId.value = "";
  memoTitleInput.value = "";
  memoContentInput.value = "";
  memoTypeInput.value = "general";
  memoPinnedInput.checked = false;
  memoSensitiveInput.checked = false;
  memoEditorHeading.textContent = "새 메모 작성";
  saveMemoButton.textContent = "메모 저장하기";
  cancelMemoEditButton.hidden = true;
}


function renderSavedMemos(memos) {
  if (!memoList || !memoCountBadge) {
    return;
  }

  memoList.replaceChildren();
  memoCountBadge.textContent = `${memos.length}개`;

  if (memos.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-message";
    empty.textContent =
      "조건에 맞는 저장 메모가 없습니다.";
    memoList.appendChild(empty);
    return;
  }

  memos.forEach((memo) => {
    const article = document.createElement("article");
    article.className = "saved-memo-item";

    if (memo.is_pinned) {
      article.classList.add("pinned");
    }

    if (memo.is_sensitive) {
      article.classList.add("sensitive");
    }

    const heading = document.createElement("div");
    heading.className = "saved-memo-heading";

    const title = document.createElement("h3");
    title.textContent = memo.title;

    const badges = document.createElement("div");
    badges.className = "saved-memo-badges";

    if (memo.is_pinned) {
      const pinnedBadge = document.createElement("span");
      pinnedBadge.className = "saved-memo-badge";
      pinnedBadge.textContent = "고정";
      badges.appendChild(pinnedBadge);
    }

    const typeBadge = document.createElement("span");
    typeBadge.className = "saved-memo-badge";
    typeBadge.textContent =
      getMemoTypeLabel(memo.memo_type);
    badges.appendChild(typeBadge);

    if (memo.is_sensitive) {
      const sensitiveBadge =
        document.createElement("span");
      sensitiveBadge.className =
        "saved-memo-badge sensitive";
      sensitiveBadge.textContent = "민감정보";
      badges.appendChild(sensitiveBadge);
    }

    heading.append(title, badges);

    const content = document.createElement("p");
    content.className = "saved-memo-content";
    content.textContent = memo.content;

    const date = document.createElement("span");
    date.className = "saved-memo-date";
    date.textContent =
      `수정: ${formatMemoDate(memo.updated_at)}`;

    const actions = document.createElement("div");
    actions.className = "saved-memo-actions";

    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "memo-pin-button";
    pinButton.textContent =
      memo.is_pinned ? "고정 해제" : "상단 고정";

    pinButton.addEventListener("click", async () => {
      await updateSavedMemo(memo.id, {
        ...memo,
        is_pinned: !memo.is_pinned,
      });
    });

    const editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "memo-edit-button";
    editButton.textContent = "수정";

    editButton.addEventListener("click", () => {
      editingMemoId.value = String(memo.id);
      memoTitleInput.value = memo.title;
      memoContentInput.value = memo.content;
      memoTypeInput.value =
        memo.memo_type || "general";
      memoPinnedInput.checked =
        Boolean(memo.is_pinned);
      memoSensitiveInput.checked =
        Boolean(memo.is_sensitive);

      memoEditorHeading.textContent = "메모 수정";
      saveMemoButton.textContent = "수정 저장하기";
      cancelMemoEditButton.hidden = false;

      document.querySelector(".memo-editor-card")
        ?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    });

    const deleteButton =
      document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className =
      "memo-delete-button";
    deleteButton.textContent = "삭제";

    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(
        `"${memo.title}" 메모를 삭제할까요?`
      );

      if (!confirmed) {
        return;
      }

      try {
        const remainingMemos = savedMemos.filter(
          (savedMemo) =>
            String(savedMemo.id) !== String(memo.id)
        );

        if (remainingMemos.length === savedMemos.length) {
          throw new Error("삭제할 메모를 찾지 못했습니다.");
        }

        writeStoredMemos(remainingMemos);
        memoEditorStatus.textContent =
          "메모가 삭제되었습니다.";
        resetMemoEditor();
        await loadMemos(
          memoSearchInput?.value.trim() || ""
        );
      } catch (error) {
        memoEditorStatus.textContent =
          `오류: ${error.message}`;
      }
    });

    actions.append(
      pinButton,
      editButton,
      deleteButton
    );

    article.append(
      heading,
      content,
      date,
      actions
    );

    memoList.appendChild(article);
  });
}


async function loadMemos(search = "") {
  if (!memoList) {
    return;
  }

  try {
    savedMemos = sortStoredMemos(readStoredMemos());

    const keyword = normalizeMemoComparisonValue(search);
    const filteredMemos = keyword
      ? savedMemos.filter((memo) => {
          return (
            normalizeMemoComparisonValue(
              memo.title
            ).includes(keyword) ||
            normalizeMemoComparisonValue(
              memo.content
            ).includes(keyword)
          );
        })
      : savedMemos;

    renderSavedMemos(filteredMemos);
  } catch (error) {
    memoList.innerHTML = "";
    const message = document.createElement("p");
    message.className = "empty-message";
    message.textContent = `오류: ${error.message}`;
    memoList.appendChild(message);
  }
}


async function updateSavedMemo(memoId, memo) {
  try {
    const memoIndex = savedMemos.findIndex(
      (savedMemo) =>
        String(savedMemo.id) === String(memoId)
    );

    if (memoIndex < 0) {
      throw new Error("수정할 메모를 찾지 못했습니다.");
    }

    const updatedMemos = savedMemos.slice();
    updatedMemos[memoIndex] = {
      ...savedMemos[memoIndex],
      title: memo.title,
      content: memo.content,
      memo_type: memo.memo_type || "general",
      is_sensitive: Boolean(memo.is_sensitive),
      is_pinned: Boolean(memo.is_pinned),
      updated_at: new Date().toISOString(),
    };

    writeStoredMemos(updatedMemos);
    memoEditorStatus.textContent =
      "메모가 수정되었습니다.";

    await loadMemos(
      memoSearchInput?.value.trim() || ""
    );

    return true;
  } catch (error) {
    memoEditorStatus.textContent =
      `오류: ${error.message}`;

    return false;
  }
}


saveMemoButton?.addEventListener(
  "click",
  async () => {
    const title = memoTitleInput.value.trim();
    const content = memoContentInput.value.trim();

    if (!title) {
      memoEditorStatus.textContent =
        "메모 제목을 입력해 주세요.";
      memoTitleInput.focus();
      return;
    }

    if (!content) {
      memoEditorStatus.textContent =
        "메모 내용을 입력해 주세요.";
      memoContentInput.focus();
      return;
    }

    const memoId = editingMemoId.value;
    const isEditing = Boolean(memoId);

    saveMemoButton.disabled = true;

    try {
      const memoData = {
        title,
        content,
        memo_type: memoTypeInput.value,
        is_sensitive: memoSensitiveInput.checked,
        is_pinned: memoPinnedInput.checked,
      };

      if (isEditing) {
        const updated = await updateSavedMemo(
          memoId,
          memoData
        );

        if (!updated) {
          return;
        }
      } else {
        if (hasDuplicateMemo(memoData)) {
          throw new Error(
            "같은 제목과 내용의 메모가 이미 저장되어 있습니다."
          );
        }

        const now = new Date().toISOString();
        const storedMemo = {
          id: createMemoId(),
          ...memoData,
          created_at: now,
          updated_at: now,
        };

        writeStoredMemos([
          ...savedMemos,
          storedMemo,
        ]);
      }

      resetMemoEditor();
      memoEditorStatus.textContent = isEditing
        ? "메모가 수정되었습니다."
        : "메모가 저장되었습니다.";

      if (!isEditing) {
        await loadMemos(
          memoSearchInput?.value.trim() || ""
        );
      }
    } catch (error) {
      memoEditorStatus.textContent =
        `오류: ${error.message}`;
    } finally {
      saveMemoButton.disabled = false;
    }
  }
);


cancelMemoEditButton?.addEventListener(
  "click",
  () => {
    resetMemoEditor();
    memoEditorStatus.textContent =
      "메모 수정을 취소했습니다.";
  }
);


memoSearchButton?.addEventListener(
  "click",
  async () => {
    const search =
      memoSearchInput?.value.trim() || "";

    clearMemoSearchButton.hidden = !search;
    await loadMemos(search);
  }
);


memoSearchInput?.addEventListener(
  "keydown",
  async (event) => {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();

    const search =
      memoSearchInput.value.trim();

    clearMemoSearchButton.hidden = !search;
    await loadMemos(search);
  }
);


clearMemoSearchButton?.addEventListener(
  "click",
  async () => {
    memoSearchInput.value = "";
    clearMemoSearchButton.hidden = true;
    await loadMemos();
  }
);


initializePage();
