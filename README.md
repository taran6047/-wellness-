# Family_Wellness

Общая панель семьи: учёт спорта, питания и здоровья с геймификацией.
Стек: Next.js (App Router), TypeScript, Tailwind CSS, Prisma + PostgreSQL, Vitest.

## Запуск

```bash
npm install
cp .env.example .env        # укажите свой DATABASE_URL
npx prisma generate
npx prisma migrate dev      # создать таблицы (нужен запущенный PostgreSQL)
npm run dev                 # http://localhost:3000
```

## Команды

- `npm run dev` — dev-сервер
- `npm run build` — сборка
- `npm test` — тесты (Vitest)
- `npx prisma generate` — сгенерировать клиент Prisma
