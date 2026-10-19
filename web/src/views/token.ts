// Екран токена доступу: сервер відповів 401 (KP_ACCESS_TOKEN увімкнено).
import { h, mount } from "../dom.js";
import { accessToken, setAccessToken } from "../api.js";
import { android, field, heading, hud, notice } from "../ui.js";

export function renderTokenScreen(root: HTMLElement, onDone: () => void): void {
  const had = !!accessToken();
  const input = h("input", { id: "access-token", type: "password", class: "input", autocomplete: "current-password", required: true });
  mount(root,
    h("div", { class: "page page--narrow" },
      hud("ДОСТУП"),
      heading("ДОСТУП", "ЗА ТОКЕНОМ.", "token-title"),
      had ? notice("err", "Токен не прийнято", ["Сервер відхилив збережений токен. Попросіть новий в адміністратора."]) : null,
      h("p", { class: "lead" }, "Сервер конструктора захищено токеном доступу. Його видає адміністратор; вводиться один раз на цьому пристрої."),
      h("form", {
        class: "block form",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const t = input.value.trim();
          if (!t) { input.focus(); return; }
          setAccessToken(t);
          android("auth", { authorization: `Bearer ${t}` });
          onDone();
        },
      },
        field("Токен доступу", input, "Зберігається в цьому браузері; вийти — «Налаштування» → «Забути токен доступу»."),
        h("button", { type: "submit", class: "btn btn--primary", id: "access-login" }, "Увійти"))));
  input.focus();
}
