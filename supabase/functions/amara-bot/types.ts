export interface Student {
  id: string;
  telegram_chat_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  current_day: number;
  current_step: number;
  day1_completed_at: string | null;
  day2_completed_at: string | null;
  day3_completed_at: string | null;
  day4_completed_at: string | null;
  next_day_unlocks_at: string | null;
  selar_account_created: boolean;
  payhip_account_created: boolean;
  payhip_link: string | null;
  github_username: string | null;
  github_repo_normal: string | null;
  github_repo_premium: string | null;
  sales_page_link: string | null;
  bot_token: string | null;
  supabase_url: string | null;
  supabase_anon_key: string | null;
  status: string;
  device_type: 'phone' | 'laptop' | 'unknown';
  tech_level: 'technical' | 'non_technical' | 'unknown';
  certificate_issued: boolean;
  certificate_issued_at: string | null;
  screenshot_attempts: number;
  github_access_token: string | null;
  last_activity_at: string | null;
  last_proactive_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhoto[];
  voice?: TelegramVoice;
  video?: TelegramVideo;
  video_note?: TelegramVideoNote;
  document?: TelegramDocument;
  sticker?: unknown;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  username?: string;
}

export interface TelegramPhoto {
  file_id: string;
  file_unique_id: string;
  file_size: number;
  width: number;
  height: number;
}

export interface TelegramVoice {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  duration: number;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramVideoNote {
  file_id: string;
  file_unique_id: string;
  duration: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface DownloadedFile {
  bytes: Uint8Array;
  mimeType: string;
}

export interface ScreenshotResult {
  verified: boolean;
  reason: string;
  guidance?: string;
  extracted?: Record<string, string>;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  message: string;
}
