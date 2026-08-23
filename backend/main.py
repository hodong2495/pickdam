from datetime import datetime
from difflib import SequenceMatcher
from io import BytesIO
from pathlib import Path
import os
import re

import pytesseract
from fastapi import (
    FastAPI,
    File,
    HTTPException,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from PIL import (
    Image,
    ImageEnhance,
    ImageOps,
    UnidentifiedImageError,
)
from pydantic import BaseModel


def normalize_korean_date_text(text: str) -> str:
    """한글 자연어 날짜를 기존 분석기가 읽기 쉬운 형식으로 정리합니다."""
    if not text:
        return ""

    normalized = text

    # 검색 결과에서 복사된 단독 출처 번호 제거
    normalized = re.sub(
        r"(?m)^\s*(?:\[\d+\]|\d+)\s*$",
        "",
        normalized,
    )

    # 2026년 2월 23일 → 2026년 2월 23일
    # 공백 종류와 개수만 통일
    normalized = re.sub(
        r"(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일",
        r"\1년 \2월 \3일",
        normalized,
    )

    

    # 2026. 2. 23. → 2026-02-23
    def replace_dotted_date(match):
        year = int(match.group(1))
        month = int(match.group(2))
        day = int(match.group(3))
        return f"{year:04d}-{month:02d}-{day:02d}"

    normalized = re.sub(
        r"\b(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})\.?",
        replace_dotted_date,
        normalized,
    )

    normalized = re.sub(r"\n{3,}", "\n\n", normalized)

    return normalized.strip()


app = FastAPI(title="AI 일정 도우미 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


if os.name == "nt":
    pytesseract.pytesseract.tesseract_cmd = (
        r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    )

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

FRONTEND_DIR = PROJECT_DIR / "frontend"

MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGE_PIXELS = 20_000_000


class TextAnalyzeRequest(BaseModel):
    text: str
    reference_year: int | None = None


def clean_text(text: str) -> str:
    lines = []

    for line in text.splitlines():
        cleaned_line = re.sub(r"[ \t]+", " ", line).strip()

        if cleaned_line:
            lines.append(cleaned_line)

    return "\n".join(lines)


def extract_event_title(text: str) -> str:
    title_patterns = [
        r"(?:제|A[lI]?|[|Il!])\s*\d+\s*(?:회|외)\s+"
        r"전국\s+[^\n,\"']{1,30}?공모전",
        r"(?:제|A[lI]?|[|Il!])\s*\d+\s*(?:회|외)\s+"
        r"[^\n,\"']{1,40}?공모전",
    ]

    for pattern in title_patterns:
        title_match = re.search(pattern, text, re.IGNORECASE)

        if not title_match:
            continue

        title = re.sub(r"\s+", " ", title_match.group(0)).strip()
        title = re.sub(
            r"^(?:제|A[lI]?|[|Il!])\s*(\d+)\s*(?:회|외)",
            r"제\1회",
            title,
            flags=re.IGNORECASE,
        )

        if re.search(r"\bICT\s*융합", text, re.IGNORECASE):
            title = re.sub(
                r"(전국\s+)ICTS?\s*공모전",
                r"\1ICT 융합 공모전",
                title,
                count=1,
                flags=re.IGNORECASE,
            )

            middle_match = re.search(
                r"전국\s+(.{1,10}?)\s*융합\s*공모전",
                title,
                re.IGNORECASE,
            )

            if middle_match:
                middle = middle_match.group(1).strip().upper()
                known_acronyms = {
                    "AI",
                    "ICT",
                    "IT",
                    "IOT",
                    "SW",
                }

                if middle not in known_acronyms:
                    title = re.sub(
                        r"(전국\s+).{1,10}?(\s*융합\s*공모전)",
                        r"\1ICT \2",
                        title,
                        count=1,
                        flags=re.IGNORECASE,
                    )

        return re.sub(r"\s+", " ", title).strip()

    return ""


def extract_year(text: str, filename: str | None) -> int:
    year_match = re.search(r"(20\d{2})\s*년", text)

    if year_match:
        return int(year_match.group(1))

    if filename:
        filename_match = re.search(
            r"(20\d{2})(\d{2})(\d{2})",
            filename,
        )

        if filename_match:
            return int(filename_match.group(1))

    return datetime.now().year


def normalize_title(line: str) -> str:
    title = line.strip("[]-· ")

    title = re.sub(
        r"^20\d{2}\s*년\s*",
        "",
        title,
    )

    title = re.sub(
        r"\s*(모집\s*안내|안내)\s*$",
        "",
        title,
    )

    title = re.sub(r"\s+", " ", title).strip()

    return title


def extract_schedule(text: str, filename: str | None) -> dict:
    lines = [
        line.strip()
        for line in text.splitlines()
        if line.strip()
    ]

    year = extract_year(text, filename)

    start_time = ""
    end_time = ""
    matched_date_line = ""

    date_time_pattern = re.compile(
        r"(?:(?P<year>20\d{2})\s*년\s*)?"
        r"(?P<month>\d{1,2})\s*월\s*"
        r"(?P<day>\d{1,2})\s*일"
        r"(?:\s*\([월화수목금토일]\))?"
        r".*?"
        r"(?P<start_hour>\d{1,2})"
        r"\s*[:시]\s*"
        r"(?P<start_minute>\d{2})?"
        r"(?:\s*[~～\-]\s*"
        r"(?P<end_hour>\d{1,2})"
        r"\s*[:시]\s*"
        r"(?P<end_minute>\d{2})?"
        r")?"
    )

    for line in lines:
        date_match = date_time_pattern.search(line)

        if not date_match:
            continue

        parsed_year = int(date_match.group("year") or year)
        month = int(date_match.group("month"))
        day = int(date_match.group("day"))
        start_hour = int(date_match.group("start_hour"))
        start_minute = int(
            date_match.group("start_minute") or 0
        )

        try:
            start_time = datetime(
                parsed_year,
                month,
                day,
                start_hour,
                start_minute,
            ).strftime("%Y-%m-%dT%H:%M")
        except ValueError:
            start_time = ""

        if date_match.group("end_hour"):
            end_hour = int(date_match.group("end_hour"))
            end_minute = int(
                date_match.group("end_minute") or 0
            )

            try:
                end_time = datetime(
                    parsed_year,
                    month,
                    day,
                    end_hour,
                    end_minute,
                ).strftime("%Y-%m-%dT%H:%M")
            except ValueError:
                end_time = ""

        matched_date_line = line
        break

    location = ""

    location_patterns = [
        r"^\s*[-·]?\s*(?:장소|교육장소|행사장소)"
        r"\s*[:：]\s*(.+)$",
        r"^\s*[-·]?\s*(?:장소|교육장소|행사장소)"
        r"\s+(.+)$",
    ]

    matched_location_line = ""

    for line in lines:
        for pattern in location_patterns:
            location_match = re.search(pattern, line)

            if location_match:
                location = location_match.group(1).strip(" -·")
                matched_location_line = line
                break

        if location:
            break

    title = extract_event_title(text)
    matched_title_lines = []

    excluded_words = (
        "web발신",
        "web#",
        "일시",
        "장소",
        "문의",
        "신청",
        "접수",
        "주제",
        "강사",
        "http",
    )

    # 첫 줄과 다음 줄이 제목/모집안내로 나뉜 OCR 결과도 처리합니다.
    if not title:
        for index, line in enumerate(lines):
            candidate = line.strip("[]-· ")

            if any(
                word.lower() in candidate.lower()
                for word in excluded_words
            ):
                continue

            if re.search(
                r"\d{1,2}\s*월\s*\d{1,2}\s*일",
                candidate,
            ):
                continue

            normalized = normalize_title(candidate)

            if len(normalized) < 4:
                continue

            if normalized in {"모집안내", "안내"}:
                continue

            title = normalized
            matched_title_lines.append(line)

            if (
                index + 1 < len(lines)
                and lines[index + 1].replace(" ", "")
                in {"모집안내", "안내"}
            ):
                matched_title_lines.append(lines[index + 1])

            break

    memo_lines = []

    for line in lines:
        if line in matched_title_lines:
            continue

        if line == matched_date_line:
            continue

        if line == matched_location_line:
            continue

        if line.replace(" ", "") in {"모집안내", "안내"}:
            continue

        memo_lines.append(line)

    memo = "\n".join(memo_lines)

    warnings = []

    if not title:
        warnings.append("일정 제목을 자동으로 찾지 못했습니다.")

    if not start_time:
        warnings.append("시작 날짜 또는 시간을 자동으로 찾지 못했습니다.")

    if not end_time:
        warnings.append(
            "종료 시간을 찾지 못했습니다. 필요하면 직접 입력하세요."
        )

    if not location:
        warnings.append("장소를 찾지 못했습니다. 필요하면 직접 입력하세요.")

    if start_time and end_time and end_time <= start_time:
        warnings.append(
            "종료 시간이 시작 시간보다 빠르거나 같습니다."
        )

    return {
        "title": title,
        "start_time": start_time,
        "end_time": end_time,
        "location": location,
        "memo": memo,
        "warnings": warnings,
    }


def make_schedule_candidate(
    title: str,
    start_time: str,
    location: str,
    memo: str,
    source_text: str,
    event_type: str,
    all_day: bool = False,
    needs_confirmation: bool = False,
) -> dict:
    warnings = []

    if needs_confirmation:
        warnings.append(
            "정확한 날짜 또는 시간을 원문에서 확인해 주세요."
        )

    if not location:
        warnings.append(
            "장소를 찾지 못했습니다. 필요하면 직접 입력하세요."
        )

    return {
        "title": title,
        "start_time": start_time,
        "end_time": "",
        "location": location,
        "memo": memo,
        "warnings": warnings,
        "event_type": event_type,
        "all_day": all_day,
        "needs_confirmation": needs_confirmation,
        "source_text": source_text,
    }


def extract_schedule_timeline(
    text: str,
    year: int,
    base_title: str,
    location: str,
    memo: str,
) -> list[dict]:
    raw_lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in text.splitlines()
        if line.strip()
    ]

    exact_dates = []

    for index, line in enumerate(raw_lines):
        compact_line = line.replace(" ", "")

        if (
            "추진일정" not in compact_line
            and "평가절차" not in compact_line
        ):
            continue

        nearby_text = "\n".join(raw_lines[index : index + 8])

        # OCR에서 월이 '윌'로 인식되는 경우를 보정합니다.
        normalized_text = re.sub(
            r"(?<=\d)윌",
            "월",
            nearby_text,
        )
        date_matches = re.finditer(
            r"(?<!\d)"
            r"(?P<month>\d{1,2})"
            r"\s*(?:월|\.)\s*"
            r"(?:(?P<day>\d{1,2})\s*\.?)?"
            r"(?:\s*(?P<qualifier>말|초|중순|초순|말일))?"
            r"(?!\d)",
            normalized_text,
        )
        current_dates = []

        for match in date_matches:
            month = int(match.group("month"))
            day_text = match.group("day")

            if not 1 <= month <= 12 or not day_text:
                continue

            try:
                parsed_date = datetime(
                    year,
                    month,
                    int(day_text),
                    0,
                    0,
                )
            except ValueError:
                continue

            current_dates.append(
                (
                    parsed_date,
                    match.group(0).strip(),
                )
            )

        if len(current_dates) >= 2:
            exact_dates = current_dates
            break

    if len(exact_dates) < 2:
        return []

    start_date, start_source = exact_dates[0]
    deadline_date, deadline_source = exact_dates[1]


    readable_characters = re.sub(
        r"[^0-9A-Za-z가-힣]",
        "",
        base_title,
    )

    if len(readable_characters) < 5:
        base_title = "공모전"



    start_title = (
        f"{base_title} 공고·접수 시작"
    ).strip()

    deadline_title = (
        f"{base_title} 접수 마감"
    ).strip()

    start_memo = (
        f"공고 시작: {start_date.strftime('%Y.%m.%d')} (종일)"
    )

    start_candidate = make_schedule_candidate(
        title=start_title,
        start_time=start_date.strftime(
            "%Y-%m-%dT%H:%M"
        ),
        location=location,
        memo=start_memo,
        source_text=start_source,
        event_type="application_start",
        all_day=True,
    )

    deadline_hour = 18
    deadline_minute = 0
    deadline_time_match = re.search(
        rf"(?<!\d){deadline_date.month}\s*[월.\-/]\s*"
        rf"{deadline_date.day}\s*일?[^\n]{{0,20}}?"
        r"(?P<hour>[01]?\d|2[0-3])\s*[:시]\s*"
        r"(?P<minute>\d{2})?",
        text,
    )

    if deadline_time_match:
        deadline_hour = int(deadline_time_match.group("hour"))
        deadline_minute = int(
            deadline_time_match.group("minute") or 0
        )

    deadline_memo = (
        f"접수 마감: {deadline_date.strftime('%Y.%m.%d')} "
        f"{deadline_hour:02d}:{deadline_minute:02d}"
    )

    deadline_candidate = make_schedule_candidate(
        title=deadline_title,
        start_time=deadline_date.replace(
            hour=deadline_hour,
            minute=deadline_minute,
        ).strftime("%Y-%m-%dT%H:%M"),
        location=location,
        memo=deadline_memo,
        source_text=deadline_source,
        event_type="application_deadline",
        all_day=False,
    )

    if deadline_time_match:
        deadline_candidate["warnings"].append(
            "마감 시간은 포스터의 날짜·시간 문구를 기준으로 설정했습니다. 원문을 확인해 주세요."
        )
    else:
        deadline_candidate["warnings"].append(
            "마감 시간을 찾지 못해 18:00으로 설정했습니다. 원문을 확인해 주세요."
        )

    return [
        start_candidate,
        deadline_candidate,
    ]



def extract_multiple_schedules(
    text: str,
    filename: str | None,
) -> list[dict]:
    year = extract_year(text, filename)

    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in text.splitlines()
        if line.strip()
    ]

    base_schedule = extract_schedule(text, filename)
    base_title = base_schedule["title"] or "안내 일정"
    location = base_schedule["location"]
    memo = base_schedule["memo"]

    candidates: list[dict] = []
    seen: set[tuple[str, str]] = set()


    timeline_candidates = extract_schedule_timeline(
        text=text,
        year=year,
        base_title=base_title,
        location=location,
        memo=memo,
    )

    if timeline_candidates:
        return timeline_candidates



    def add_candidate(
        title_suffix: str,
        start_time: str,
        source_text: str,
        event_type: str,
        all_day: bool,
        needs_confirmation: bool = False,
    ) -> None:
        candidate_title = f"{base_title} {title_suffix}".strip()
        deduplication_key = (
            event_type,
            start_time,
        )

        if deduplication_key in seen:
            return

        seen.add(deduplication_key)

        candidates.append(
            make_schedule_candidate(
                title=candidate_title,
                start_time=start_time,
                location=location,
                memo=memo,
                source_text=source_text,
                event_type=event_type,
                all_day=all_day,
                needs_confirmation=needs_confirmation,
            )
        )

    full_text = "\n".join(lines)

    # 예: 아이브는 2026년 2월 23일 앨범을 발매할 예정입니다.
    korean_full_date_pattern = re.compile(
        r"(?P<year>\d{4})\s*년\s*"
        r"(?P<month>\d{1,2})\s*월\s*"
        r"(?P<day>\d{1,2})\s*일"
    )

    for line in lines:
        for match in korean_full_date_pattern.finditer(line):
            try:
                event_date = datetime(
                    int(match.group("year")),
                    int(match.group("month")),
                    int(match.group("day")),
                )
            except ValueError:
                continue

            title = korean_full_date_pattern.sub(
                "",
                line,
                count=1,
            )

            title = re.sub(
                r"^\s*(.+?)(?:은|는)\s+",
                r"\1 ",
                title,
            )
            title = re.sub(
                r"(?:이|가|을|를)?\s*"
                r"(?:발매될|발매할)\s*예정입니다\.?\s*$",
                " 발매",
                title,
            )
            title = re.sub(
                r"\s*예정입니다\.?\s*$",
                "",
                title,
            )
            title = re.sub(r"\s+", " ", title).strip(
                " .,",
            )

            if not title:
                title = base_title

            start_time = event_date.strftime(
                "%Y-%m-%dT00:00"
            )

            deduplication_key = (
                "general",
                start_time,
            )

            if deduplication_key in seen:
                continue

            seen.add(deduplication_key)

            candidates.append(
                make_schedule_candidate(
                    title=title,
                    start_time=start_time,
                    location=location,
                    memo=memo,
                    source_text=line,
                    event_type="general",
                    all_day=True,
                    needs_confirmation=True,
                )
            )


    # 예: 2026.7.15.(수) ▶ 9.15.(화) 18:00
    period_pattern = re.compile(
        r"(?:(?P<start_year>20\d{2})\s*[년.\-/]\s*)?"
        r"(?P<start_month>\d{1,2})\s*[월.\-/]\s*"
        r"(?P<start_day>\d{1,2})\s*일?"
        r"(?:\s*\([월화수목금토일]\))?"
        r"\s*(?:▶|→|~|～|-)\s*"
        r"(?:(?P<end_year>20\d{2})\s*[년.\-/]\s*)?"
        r"(?P<end_month>\d{1,2})\s*[월.\-/]\s*"
        r"(?P<end_day>\d{1,2})\s*일?"
        r"(?:\s*\([월화수목금토일]\))?"
        r"(?:\s*[.]?\s*(?P<ampm>오전|오후|AM|PM)?\s*"
        r"(?P<end_hour>\d{1,2})"
        r"\s*[:시]\s*"
        r"(?P<end_minute>\d{2})?)?",
        re.IGNORECASE,
    )

    period_match = period_pattern.search(full_text)

    if period_match:
        start_year = int(
            period_match.group("start_year") or year
        )
        start_month = int(period_match.group("start_month"))
        start_day = int(period_match.group("start_day"))

        end_year = int(
            period_match.group("end_year") or start_year
        )
        end_month = int(period_match.group("end_month"))
        end_day = int(period_match.group("end_day"))

        try:
            start_value = datetime(
                start_year,
                start_month,
                start_day,
                0,
                0,
            ).strftime("%Y-%m-%dT%H:%M")

            add_candidate(
                title_suffix="공고·접수 시작",
                start_time=start_value,
                source_text=period_match.group(0),
                event_type="application_start",
                all_day=True,
            )
        except ValueError:
            pass

        end_hour = int(
            period_match.group("end_hour") or 0
        )
        end_minute = int(
            period_match.group("end_minute") or 0
        )

        ampm = (
            period_match.group("ampm") or ""
        ).upper()

        if ampm in {"오후", "PM"} and end_hour < 12:
            end_hour += 12

        if ampm in {"오전", "AM"} and end_hour == 12:
            end_hour = 0

        try:
            end_value = datetime(
                end_year,
                end_month,
                end_day,
                end_hour,
                end_minute,
            ).strftime("%Y-%m-%dT%H:%M")

            add_candidate(
                title_suffix="접수 마감",
                start_time=end_value,
                source_text=period_match.group(0),
                event_type="application_deadline",
                all_day=period_match.group("end_hour") is None,
            )
        except ValueError:
            pass

    # 예: 공고·접수 7.15. / 접수 마감 9.15.
    keyword_patterns = [
        (
            "공고·접수 시작",
            "application_start",
            (
                r"(?:공고\s*[·ㆍ/]?\s*접수|접수\s*시작|"
                r"신청\s*시작|공고일)"
            ),
        ),
        (
            "접수 마감",
            "application_deadline",
            (
                r"(?:접수\s*마감|신청\s*마감|"
                r"마감일|제출\s*마감)"
            ),
        ),
        (
            "서면 심사",
            "document_review",
            r"(?:서면\s*심사|서류\s*심사)",
        ),
        (
            "발표·시상",
            "announcement",
            r"(?:발표\s*[·ㆍ/]?\s*시상|결과\s*발표|시상식)",
        ),
    ]

    date_pattern_text = (
        r"(?:(?P<year>20\d{2})\s*[년.\-/]\s*)?"
        r"(?P<month>\d{1,2})\s*[월.\-/]\s*"
        r"(?P<day>\d{1,2})\s*일?"
        r"(?:\s*\([월화수목금토일]\))?"
        r"(?:\s*[.]?\s*(?P<ampm>오전|오후|AM|PM)?\s*"
        r"(?P<hour>\d{1,2})"
        r"\s*[:시]\s*"
        r"(?P<minute>\d{2})?)?"
    )

    for line in lines:
        for title_suffix, event_type, keyword_pattern in (
            keyword_patterns
        ):
            if not re.search(
                keyword_pattern,
                line,
                re.IGNORECASE,
            ):
                continue

            date_match = re.search(
                date_pattern_text,
                line,
                re.IGNORECASE,
            )

            if not date_match:
                continue

            parsed_year = int(
                date_match.group("year") or year
            )
            month = int(date_match.group("month"))
            day = int(date_match.group("day"))


            hour_text = date_match.group("hour")
            minute_text = date_match.group("minute")
            ampm = (date_match.group("ampm") or "").upper()

            if (
                hour_text is None
                and event_type == "application_deadline"
            ):
                time_match = re.search(
                    r"(?P<ampm>오전|오후|AM|PM)?\s*"
                    r"(?P<hour>\d{1,2})\s*[:시]\s*"
                    r"(?P<minute>\d{2})?",
                    line,
                    re.IGNORECASE,
                )

                if time_match:
                    hour_text = time_match.group("hour")
                    minute_text = time_match.group("minute")
                    ampm = (
                        time_match.group("ampm") or ""
                    ).upper()

            hour = int(hour_text or 0)
            minute = int(minute_text or 0)



            if ampm in {"오후", "PM"} and hour < 12:
                hour += 12

            if ampm in {"오전", "AM"} and hour == 12:
                hour = 0

            try:
                date_value = datetime(
                    parsed_year,
                    month,
                    day,
                    hour,
                    minute,
                ).strftime("%Y-%m-%dT%H:%M")
            except ValueError:
                continue

            add_candidate(
                title_suffix=title_suffix,
                start_time=date_value,
                source_text=line,
                event_type=event_type,
                all_day=hour_text is None,
            )

    # 여러 일정 규칙에 맞는 후보가 없으면 기존 결과를 유지합니다.
    if not candidates:
        fallback = {
            **base_schedule,
            "event_type": "general",
            "all_day": False,
            "needs_confirmation": False,
            "source_text": "",
        }

        candidates.append(fallback)

    return candidates

def extract_important_memos(text: str) -> list[dict]:
    lines = [
        re.sub(r"\s+", " ", line).strip()
        for line in text.splitlines()
        if line.strip()
    ]

    memo_rules = [
        (
            "문의처",
            "contact",
            r"(?:문의|연락처|담당자|전화|E-?mail)",
        ),
        (
            "신청 및 접수",
            "application",
            r"(?:신청|접수|온라인\s*접수|제출|"
            r"홈페이지|www\.|페이지.{0,30}등록)",
        ),
        (
            "준비물",
            "preparation",
            r"(?:준비물|지참물|구비서류)",
        ),
        (
            "계정 정보",
            "account",
            r"(?:아이디(?!어)|\bID\b|계정|로그인)",
        ),
        (
            "결제 및 입금",
            "payment",
            r"(?:결제|입금|납부|계좌)",
        ),
        (
            "방문 안내",
            "visit",
            r"(?:주차장|주차\s*(?:가능|안내|불가|무료|유료)|"
            r"출입|방문|입장|오시는\s*길)",
        ),
        (
            "민감정보",
            "sensitive",
            r"(?:비밀번호|패스워드|password|인증번호|PIN)",
        ),
    ]

    sensitive_pattern = re.compile(
        r"(?:"
        r"비밀번호|패스워드|password|"
        r"인증번호|일회용\s*번호|OTP|PIN|"
        r"\d{6}\s*[-]\s*\d{7}|"
        r"(?:계좌|입금)[^\n]{0,20}\d{8,16}"
        r")",
        re.IGNORECASE,
    )

    memos = []
    seen: list[tuple[str, str]] = []
    type_counts: dict[str, int] = {}
    type_limits = {
        "application": 2,
        "contact": 1,
        "preparation": 1,
        "account": 1,
        "payment": 1,
        "visit": 1,
        "sensitive": 1,
    }
    heading_words = {
        "공모분야",
        "신청요건",
        "제출서류",
        "접수및제출",
        "평가절차",
        "시상내역",
        "수상자혜택및지원",
    }

    def memo_priority(line: str) -> int:
        score = 0

        if re.search(r"https?://|www\.", line, re.IGNORECASE):
            score += 8

        if re.search(r"홈페이지|페이지|접속", line):
            score += 5

        if re.search(r"등록|신청서|동의서|계획서|\d+\s*부", line):
            score += 4

        if re.search(
            r"E-?mail|[\w.+-]+@[\w.-]+|\d{2,4}-\d{3,4}-\d{4}",
            line,
            re.IGNORECASE,
        ):
            score += 8

        return score

    lines.sort(key=memo_priority, reverse=True)

    for line in lines:
        matched_title = ""
        matched_type = ""

        for title, memo_type, pattern in memo_rules:
            if re.search(pattern, line, re.IGNORECASE):
                matched_title = title
                matched_type = memo_type
                break

        if not matched_type:
            continue

        normalized_line = line.strip(" -·")

        readable_text = re.sub(
            r"[^0-9A-Za-z가-힣]",
            "",
            normalized_line,
        )
        compact_line = normalized_line.replace(" ", "")

        if len(readable_text) < 8 or len(normalized_line) > 180:
            continue

        if compact_line.strip("|·ㆍ/[]()") in heading_words:
            continue

        if (
            len(normalized_line) <= 30
            and any(word in compact_line for word in heading_words)
            and not re.search(r"\d|https?://|www\.", normalized_line)
        ):
            continue

        if matched_type == "application" and not re.search(
            r"(?:https?://|www\.|홈페이지|페이지|접속|등록|"
            r"서류|신청서|동의서|계획서|마감|까지|\d+\s*부|"
            r"\d{1,2}\s*월)",
            normalized_line,
            re.IGNORECASE,
        ):
            continue

        if matched_type == "contact":
            phone_match = re.search(
                r"(?<!\d)(0\d{1,2})[-.\s](\d{3,4})[-.\s](\d{4})(?!\d)",
                normalized_line,
            )
            email_match = re.search(
                r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}",
                normalized_line,
                re.IGNORECASE,
            )
            contact_parts = []

            if phone_match:
                contact_parts.append("-".join(phone_match.groups()))

            if email_match:
                contact_parts.append(email_match.group(0))

            if contact_parts:
                normalized_line = "문의: " + " / ".join(contact_parts)

        if matched_type == "application":
            url_match = re.search(
                r"(?:https?://)?(?:www\.)?"
                r"[A-Za-z0-9.-]+\.(?:or\.kr|co\.kr|go\.kr|"
                r"com|org|net|kr)(?:/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*)?",
                normalized_line,
                re.IGNORECASE,
            )

            if url_match:
                url = url_match.group(0).rstrip(".,;)")

                if not url.lower().startswith(("http://", "https://")):
                    url = f"https://{url}"

                normalized_line = f"접수 홈페이지: {url}"
            else:
                normalized_line = re.split(
                    r"\s+[·ㆍ]\s+",
                    normalized_line.lstrip("*#|·ㆍ "),
                    maxsplit=1,
                )[0].strip()

        deduplication_key = re.sub(
            r"[^0-9A-Za-z가-힣]",
            "",
            normalized_line,
        ).lower()

        if any(
            saved_type == matched_type
            and SequenceMatcher(
                None,
                saved_key,
                deduplication_key,
            ).ratio() >= 0.78
            for saved_type, saved_key in seen
        ):
            continue

        if type_counts.get(matched_type, 0) >= type_limits.get(
            matched_type,
            1,
        ):
            continue

        seen.append(
            (
                matched_type,
                deduplication_key,
            )
        )
        type_counts[matched_type] = (
            type_counts.get(matched_type, 0) + 1
        )

        is_sensitive = (
            matched_type == "sensitive"
            or bool(
                sensitive_pattern.search(normalized_line)
            )
        )

        warnings = []

        if is_sensitive:
            warnings.append(
                "민감정보가 포함되어 있을 수 있습니다. 저장 전에 원문을 확인해 주세요."
            )

        memos.append(
            {
                "title": matched_title,
                "content": normalized_line,
                "memo_type": matched_type,
                "is_sensitive": is_sensitive,
                "warnings": warnings,
                "source_text": line,
            }
        )

        if len(memos) >= 4:
            break

    return memos


def build_analysis_response(
    text: str,
    filename: str | None = None,
    reference_year: int | None = None,
) -> dict:
    cleaned_text = clean_text(text)

    if not cleaned_text:
        raise HTTPException(
            status_code=422,
            detail="분석할 텍스트를 입력해 주세요.",
        )

    analysis_filename = filename

    if reference_year is not None:
        current_year = datetime.now().year

        if reference_year < 2000 or reference_year > current_year + 20:
            raise HTTPException(
                status_code=422,
                detail="기준 연도를 올바르게 입력해 주세요.",
            )

        # 기존 extract_year()가 본문에 있는 연도를 우선 사용하도록
        # 기준 연도를 본문 앞에 분석 보조 정보로 붙입니다.
        if not re.search(r"20\d{2}\s*년", cleaned_text):
            cleaned_text_for_analysis = (
                f"{reference_year}년\n{cleaned_text}"
            )
        else:
            cleaned_text_for_analysis = cleaned_text
    else:
        cleaned_text_for_analysis = cleaned_text

    schedules = extract_multiple_schedules(
        cleaned_text_for_analysis,
        analysis_filename,
    )

    important_memos = extract_important_memos(
    cleaned_text
    )

    primary_schedule = schedules[0]

    return {
        **primary_schedule,
        "schedules": schedules,
        "schedule_count": len(schedules),
        "important_memos": important_memos,
        "memo_count": len(important_memos),
        "ocr_text": cleaned_text,
        "filename": filename,
        "input_type": (
            "image"
            if filename
            else "text"
        ),
    }




@app.get("/health")
def health_check():
    return {
        "message": "AI 일정 도우미 서버가 정상 작동 중입니다."
    }



@app.post("/analyze")
async def analyze_schedule(
    image: UploadFile = File(...),
):
    allowed_types = {
        "image/png",
        "image/jpeg",
        "image/jpg",
    }

    if image.content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail="PNG 또는 JPG 이미지만 업로드할 수 있습니다.",
        )

    image_bytes = await image.read(MAX_IMAGE_BYTES + 1)

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="비어 있는 이미지입니다.",
        )

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="이미지 크기는 10MB 이하여야 합니다.",
        )

    try:
        with Image.open(BytesIO(image_bytes)) as uploaded_image:
            if uploaded_image.format not in {"PNG", "JPEG"}:
                raise HTTPException(
                    status_code=400,
                    detail="실제 PNG 또는 JPG 이미지 파일만 업로드할 수 있습니다.",
                )

            width, height = uploaded_image.size

            if width * height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413,
                    detail="이미지 해상도는 2천만 픽셀 이하여야 합니다.",
                )

            processed_image = ImageOps.exif_transpose(
                uploaded_image
            )
            processed_image = processed_image.convert("L")
            processed_image = ImageOps.autocontrast(
                processed_image
            )
            processed_image = ImageEnhance.Contrast(
                processed_image
            ).enhance(1.5)

            ocr_text = pytesseract.image_to_string(
                processed_image,
                lang="kor+eng",
                config="--oem 3 --psm 6",
            )

            width, height = processed_image.size

            if height >= width * 1.15:
                left_image = processed_image.crop(
                    (0, 0, max(1, int(width * 0.65)), height)
                )
                scale = min(
                    1.5,
                    2400 / max(left_image.size),
                )

                if abs(scale - 1) >= 0.05:
                    left_image = left_image.resize(
                        (
                            max(1, int(left_image.width * scale)),
                            max(1, int(left_image.height * scale)),
                        ),
                        Image.Resampling.LANCZOS,
                    )

                left_ocr_text = pytesseract.image_to_string(
                    left_image,
                    lang="kor+eng",
                    config="--oem 3 --psm 6",
                )

                if left_ocr_text.strip():
                    ocr_text = f"{ocr_text}\n{left_ocr_text}"

    except Image.DecompressionBombError as error:
        raise HTTPException(
            status_code=413,
            detail="이미지 해상도가 너무 큽니다.",
        ) from error

    except UnidentifiedImageError as error:
        raise HTTPException(
            status_code=400,
            detail="올바른 이미지 파일이 아닙니다.",
        ) from error

    except pytesseract.TesseractNotFoundError as error:
        raise HTTPException(
            status_code=500,
            detail="Tesseract 실행 파일을 찾지 못했습니다.",
        ) from error

    except pytesseract.TesseractError as error:
        raise HTTPException(
            status_code=500,
            detail=f"OCR 처리 오류: {error}",
        ) from error

    ocr_text = clean_text(ocr_text)

    if not ocr_text:
        raise HTTPException(
            status_code=422,
            detail="이미지에서 글자를 인식하지 못했습니다.",
        )

    return build_analysis_response(
        text=ocr_text,
        filename=image.filename,
    )


@app.post("/analyze-text")
def analyze_text(request: TextAnalyzeRequest):
    normalized_text = normalize_korean_date_text(
        request.text
    )

    return build_analysis_response(
        text=normalized_text,
        reference_year=request.reference_year,
    )


app.mount(
    "/",
    StaticFiles(
        directory=str(FRONTEND_DIR),
        html=True,
    ),
    name="frontend",
)
