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
    recoveryToggle: string;
    recoveryExportHint: string;
    recoveryCopyButton: string;
    recoveryCopiedHint: string;
    recoveryImportHint: string;
    recoveryInputPlaceholder: string;
    recoveryRestoreButton: string;
    onlineLabel: string;
    onlineBtnTitle: string;
    onlineListTitle: string;
    onlineListHint: string;
    whisperRowTitle: string;
    whisperWith: string;
    whisperPlaceholder: string;
    closeLabel: string;
    ogDescription: string;
    errors: {
      nickname_invalid: string;
      nickname_required: string;
      cooldown: string;
      jailed: string;
      invalid_recovery_code: string;
      whisper_self: string;
      whisper_offline: string;
    };
  };
}

const MESSAGES: Record<Locale, Messages> = {
  en: {
    landing: {
      intro:
        "Every subdomain is its own chat room, created automatically the moment you visit. Try newyork.godot.chat or apple.godot.chat.",
      roomPlaceholder: "Room name (1-12 letters/digits/-, CJK ok)",
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
      recoveryToggle: "Identity recovery code",
      recoveryExportHint:
        "This is your recovery code for this room. Save it somewhere safe — paste the same code on another device or browser to keep using this identity instead of starting a new one. Anyone with this code can impersonate you here, so don't share it.",
      recoveryCopyButton: "Copy",
      recoveryCopiedHint: "Copied",
      recoveryImportHint: "Already have a recovery code? Paste it here to keep your identity:",
      recoveryInputPlaceholder: "Paste recovery code",
      recoveryRestoreButton: "Restore",
      onlineLabel: "{count} online",
      onlineBtnTitle: "Click to see who's online",
      onlineListTitle: "Who's here",
      onlineListHint: "Click someone's name to send them a private message.",
      whisperRowTitle: "Click to whisper",
      whisperWith: "Private message to {nickname}",
      whisperPlaceholder: "Send a private message…",
      closeLabel: "Close",
      ogDescription: "Live chat in #{room} on godot.chat",
      errors: {
        nickname_invalid: "Invalid nickname",
        nickname_required: "Set a nickname first",
        cooldown: "You're sending messages too fast — wait a few seconds",
        jailed: "Too many identity switches from this connection — blocked for a while",
        invalid_recovery_code: "That doesn't look like a valid recovery code",
        whisper_self: "You can't whisper yourself",
        whisper_offline: "That person isn't online anymore",
      },
    },
  },
  es: {
    landing: {
      intro:
        "Cada subdominio es su propia sala de chat, creada automáticamente al entrar. Prueba newyork.godot.chat o apple.godot.chat.",
      roomPlaceholder: "Nombre de sala (1-12 letras/dígitos/-, CJK también)",
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
      recoveryToggle: "Código de recuperación de identidad",
      recoveryExportHint:
        "Este es tu código de recuperación para esta sala. Guárdalo en un lugar seguro — pega el mismo código en otro dispositivo o navegador para seguir usando esta identidad en vez de crear una nueva. Cualquiera con este código puede hacerse pasar por ti aquí, así que no lo compartas.",
      recoveryCopyButton: "Copiar",
      recoveryCopiedHint: "Copiado",
      recoveryImportHint: "¿Ya tienes un código de recuperación? Pégalo aquí para conservar tu identidad:",
      recoveryInputPlaceholder: "Pega el código de recuperación",
      recoveryRestoreButton: "Restaurar",
      onlineLabel: "{count} en línea",
      onlineBtnTitle: "Haz clic para ver quién está en línea",
      onlineListTitle: "Quién está aquí",
      onlineListHint: "Haz clic en el nombre de alguien para enviarle un mensaje privado.",
      whisperRowTitle: "Haz clic para enviar un mensaje privado",
      whisperWith: "Mensaje privado a {nickname}",
      whisperPlaceholder: "Envía un mensaje privado…",
      closeLabel: "Cerrar",
      ogDescription: "Chat en vivo en #{room} en godot.chat",
      errors: {
        nickname_invalid: "Apodo no válido",
        nickname_required: "Elige un apodo primero",
        cooldown: "Estás enviando mensajes demasiado rápido — espera unos segundos",
        jailed: "Demasiados cambios de identidad desde esta conexión — bloqueado por un tiempo",
        invalid_recovery_code: "Ese código de recuperación no parece válido",
        whisper_self: "No puedes enviarte un mensaje privado a ti mismo",
        whisper_offline: "Esa persona ya no está en línea",
      },
    },
  },
  "zh-Hans": {
    landing: {
      intro: "任意子域名都是一个独立聊天室,进去就自动创建。例如 newyork.godot.chat、apple.godot.chat。",
      roomPlaceholder: "房间名 (1-12 位字母/数字/汉字/-)",
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
      recoveryToggle: "身份恢复码",
      recoveryExportHint:
        "这是你在本房间的身份恢复码,保存好。换设备或换浏览器后,粘贴同一段代码就能继续用这个身份,不用重新建号。谁拿到这段代码就能在这个房间冒充你,不要分享给别人。",
      recoveryCopyButton: "复制",
      recoveryCopiedHint: "已复制",
      recoveryImportHint: "已经有恢复码?粘贴到这里继续用原来的身份:",
      recoveryInputPlaceholder: "粘贴恢复码",
      recoveryRestoreButton: "恢复",
      onlineLabel: "在线 {count} 人",
      onlineBtnTitle: "点击查看在线列表",
      onlineListTitle: "在线列表",
      onlineListHint: "点击某人的名字可以给 TA 发私聊消息。",
      whisperRowTitle: "点击私聊",
      whisperWith: "私聊 {nickname}",
      whisperPlaceholder: "发一句悄悄话…",
      closeLabel: "关闭",
      ogDescription: "godot.chat 上的 #{room} 实时聊天室",
      errors: {
        nickname_invalid: "昵称不合法",
        nickname_required: "请先设置昵称",
        cooldown: "发言太快了,歇几秒再说",
        jailed: "短时间内切换身份太多次,已被暂时限制",
        invalid_recovery_code: "恢复码格式不对",
        whisper_self: "不能私聊自己",
        whisper_offline: "对方已经不在线了",
      },
    },
  },
  "zh-Hant": {
    landing: {
      intro: "任意子網域都是一個獨立聊天室,進去就自動建立。例如 newyork.godot.chat、apple.godot.chat。",
      roomPlaceholder: "房間名 (1-12 位字母/數字/漢字/-)",
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
      recoveryToggle: "身分復原碼",
      recoveryExportHint:
        "這是你在本房間的身分復原碼,保存好。換裝置或換瀏覽器後,貼上同一段代碼就能繼續用這個身分,不用重新建號。誰拿到這段代碼就能在這個房間冒充你,不要分享給別人。",
      recoveryCopyButton: "複製",
      recoveryCopiedHint: "已複製",
      recoveryImportHint: "已經有復原碼?貼到這裡繼續用原來的身分:",
      recoveryInputPlaceholder: "貼上復原碼",
      recoveryRestoreButton: "復原",
      onlineLabel: "在線 {count} 人",
      onlineBtnTitle: "點擊查看在線列表",
      onlineListTitle: "在線列表",
      onlineListHint: "點擊某人的名字可以傳私訊給 TA。",
      whisperRowTitle: "點擊傳私訊",
      whisperWith: "私訊 {nickname}",
      whisperPlaceholder: "傳一句悄悄話…",
      closeLabel: "關閉",
      ogDescription: "godot.chat 上的 #{room} 即時聊天室",
      errors: {
        nickname_invalid: "暱稱不合法",
        nickname_required: "請先設定暱稱",
        cooldown: "發言太快了,歇幾秒再說",
        jailed: "短時間內切換身分太多次,已被暫時限制",
        invalid_recovery_code: "復原碼格式不對",
        whisper_self: "不能私訊自己",
        whisper_offline: "對方已經不在線了",
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
