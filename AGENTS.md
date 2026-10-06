# Правила проекта Family_Wellness

Пользователь — женского рода, общайся с ней по-русски: объяснения, вопросы, итоги и отчёты пиши по-русски. Код, команды и имена файлов оставляй на английском.

## Рабочие файлы
- `goal.md` — цель и намерение проекта. Главный источник правды: если задача расходится с ним, сначала уточни.
- `status.md` — текущее состояние: что сделано, что в работе, что дальше. Обновляй после каждого заметного шага.
- `plans/` — планы работ, по одному файлу на план (`plans/01-название.md`).

## Порядок работы
1. Не пиши код, пока не понятна задача: используй skill `interview-me`.
2. Крупную задачу сначала оформи планом в `plans/` (режим `/plan`), дождись одобрения.
3. Реализацию веди через skill `implement` и субагентов: Имплементор, Писатель тестов, Прогонятель тестов, Аудитор.
4. Делай небольшие коммиты с понятными сообщениями на русском.

## Принципы
- Делай только то, что просили; без лишних файлов и «улучшений».
- Простое решение лучше сложного.
- Не удаляй и не перезаписывай существующее, не посмотрев, что там.
- Секреты (ключи, токены, пароли) не коммить; держи в `.env`, который есть в `.gitignore`.
- Если что-то не получилось или тесты падают, говори об этом прямо.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
