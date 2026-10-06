// Стоимость хеширования bcrypt (используется при регистрации и в заглушке для входа)
export const BCRYPT_COST = 10;

// Защита входа от перебора: столько неудачных попыток за окно блокируют вход на время блокировки
export const MAX_LOGIN_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
export const LOGIN_LOCKED_ERROR = "Слишком много попыток, попробуйте позже";

// Пояс можно менять не чаще одного раза в 7 дней
export const TIME_ZONE_CHANGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Лимиты против накрутки и засорения базы
export const MAX_FAMILY_GOALS = 20;
export const MAX_DAILY_RECORDS = 50;
