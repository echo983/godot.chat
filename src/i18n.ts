export type Locale = "en" | "es" | "zh-Hans" | "zh-Hant";

export const SUPPORTED_LOCALES: Locale[] = ["en", "es", "zh-Hans", "zh-Hant"];
export const DEFAULT_LOCALE: Locale = "en";

// 下拉框里始终显示各语言的本名,不跟着当前语言翻译——这是通行的语言切换器惯例
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  es: "Español",
  "zh-Hans": "简体中文",
  "zh-Hant": "繁體中文",
};

export interface Messages {
  landing: {
    intro: string;
    roomPlaceholder: string;
    enterButton: string;
  };
  chat: {
    connecting: string;
    connected: string;
    disconnected: string;
    connectionError: string;
    textPlaceholder: string;
    sendButton: string;
    changeNicknameTitle: string;
    unnamed: string;
    anonymous: string;
    nickDialogTitle: string;
    nickDialogBody: string;
    nickInputPlaceholder: string;
    nickConfirmButton: string;
    errors: {
      nickname_invalid: string;
      nickname_required: string;
      cooldown: string;
      jailed: string;
    };
  };
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    landing: {
      intro:
        "Every subdomain is its own chat room, created automatically the moment you visit. Try newyork.godot.chat or apple.godot.chat.",
      roomPlaceholder: "Room name (1-12 lowercase letters/digits/-)",
      enterButton: "Enter",
    },
    chat: {
      connecting: "Connecting…",
      connected: "Connected",
      disconnected: "Disconnected",
      connectionError: "Connection error",
      textPlaceholder: "Say something…",
      sendButton: "Send",
      changeNicknameTitle: "Click to change nickname",
      unnamed: "Unnamed",
      anonymous: "Anonymous",
      nickDialogTitle: "Choose a nickname",
      nickDialogBody:
        "Next to your name you'll get an avatar generated from your identity hash, plus its last 4 characters — no one else can match both.",
      nickInputPlaceholder: "1-20 characters",
      nickConfirmButton: "Confirm",
      errors: {
        nickname_invalid: "Invalid nickname",
        nickname_required: "Set a nickname first",
        cooldown: "You're sending messages too fast — wait a few seconds",
        jailed: "Too many identity switches from this connection — blocked for a while",
      },
    },
  },
  es: {
    landing: {
      intro:
        "Cada subdominio es su propia sala de chat, creada automáticamente al entrar. Prueba newyork.godot.chat o apple.godot.chat.",
      roomPlaceholder: "Nombre de sala (1-12 letras minúsculas/dígitos/-)",
      enterButton: "Entrar",
    },
    chat: {
      connecting: "Conectando…",
      connected: "Conectado",
      disconnected: "Desconectado",
      connectionError: "Error de conexión",
      textPlaceholder: "Escribe algo…",
      sendButton: "Enviar",
      changeNicknameTitle: "Haz clic para cambiar el apodo",
      unnamed: "Sin nombre",
      anonymous: "Anónimo",
      nickDialogTitle: "Elige un apodo",
      nickDialogBody:
        "Junto a tu nombre aparecerá un avatar generado a partir del hash de tu identidad, más sus últimos 4 caracteres — nadie más podrá igualar ambos.",
      nickInputPlaceholder: "1-20 caracteres",
      nickConfirmButton: "Confirmar",
      errors: {
        nickname_invalid: "Apodo no válido",
        nickname_required: "Elige un apodo primero",
        cooldown: "Estás enviando mensajes demasiado rápido — espera unos segundos",
        jailed: "Demasiados cambios de identidad desde esta conexión — bloqueado por un tiempo",
      },
    },
  },
  "zh-Hans": {
    landing: {
      intro: "任意子域名都是一个独立聊天室,进去就自动创建。例如 newyork.godot.chat、apple.godot.chat。",
      roomPlaceholder: "房间名 (1-12 位小写字母/数字/-)",
      enterButton: "进入",
    },
    chat: {
      connecting: "连接中…",
      connected: "已连接",
      disconnected: "连接已断开",
      connectionError: "连接出错",
      textPlaceholder: "说点什么…",
      sendButton: "发送",
      changeNicknameTitle: "点击更换昵称",
      unnamed: "未命名",
      anonymous: "匿名",
      nickDialogTitle: "选一个昵称",
      nickDialogBody: "昵称右边会带一个基于你身份哈希生成的头像和后四位,别人改不出跟你一样的。",
      nickInputPlaceholder: "1-20 个字符",
      nickConfirmButton: "确定",
      errors: {
        nickname_invalid: "昵称不合法",
        nickname_required: "请先设置昵称",
        cooldown: "发言太快了,歇几秒再说",
        jailed: "短时间内切换身份太多次,已被暂时限制",
      },
    },
  },
  "zh-Hant": {
    landing: {
      intro: "任意子網域都是一個獨立聊天室,進去就自動建立。例如 newyork.godot.chat、apple.godot.chat。",
      roomPlaceholder: "房間名 (1-12 位小寫字母/數字/-)",
      enterButton: "進入",
    },
    chat: {
      connecting: "連線中…",
      connected: "已連線",
      disconnected: "連線已中斷",
      connectionError: "連線發生錯誤",
      textPlaceholder: "說點什麼…",
      sendButton: "傳送",
      changeNicknameTitle: "點擊更換暱稱",
      unnamed: "未命名",
      anonymous: "匿名",
      nickDialogTitle: "選一個暱稱",
      nickDialogBody: "暱稱右邊會帶一個根據你的身分雜湊產生的頭像和後四碼,別人改不出跟你一樣的。",
      nickInputPlaceholder: "1-20 個字元",
      nickConfirmButton: "確定",
      errors: {
        nickname_invalid: "暱稱不合法",
        nickname_required: "請先設定暱稱",
        cooldown: "發言太快了,歇幾秒再說",
        jailed: "短時間內切換身分太多次,已被暫時限制",
      },
    },
  },
};

export function t(locale: Locale): Messages {
  return MESSAGES[locale];
}

function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";q=");
      const q = qPart ? parseFloat(qPart) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}

function mapTagToLocale(tag: string): Locale | null {
  if (tag.startsWith("zh")) {
    if (tag.includes("hant") || tag.includes("tw") || tag.includes("hk") || tag.includes("mo")) {
      return "zh-Hant";
    }
    // 裸 "zh"、zh-CN、zh-Hans、zh-SG 等按简体处理
    return "zh-Hans";
  }
  if (tag.startsWith("es")) return "es";
  if (tag.startsWith("en")) return "en";
  return null;
}

function readCookieLang(cookieHeader: string | null): Locale | null {
  if (!cookieHeader) return null;
  const match = /(?:^|;\s*)lang=([a-zA-Z-]+)/.exec(cookieHeader);
  const value = match?.[1];
  if (value && (SUPPORTED_LOCALES as string[]).includes(value)) {
    return value as Locale;
  }
  return null;
}

/**
 * 优先级:手动切换过的 lang cookie(跨房间共享,domain=.godot.chat) >
 * 浏览器 Accept-Language > 默认英语。没手动选过语言时不会写 cookie,
 * 所以会一直跟着浏览器设置自适应。
 */
export function resolveLocale(request: Request): Locale {
  const cookieLocale = readCookieLang(request.headers.get("Cookie"));
  if (cookieLocale) return cookieLocale;

  const acceptLanguage = request.headers.get("Accept-Language");
  if (acceptLanguage) {
    for (const tag of parseAcceptLanguage(acceptLanguage)) {
      const mapped = mapTagToLocale(tag);
      if (mapped) return mapped;
    }
  }

  return DEFAULT_LOCALE;
}
