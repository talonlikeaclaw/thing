import {
  Calendar,
  CalendarClock,
  CheckSquare,
  CircleDot,
  File,
  Hash,
  Image,
  Link,
  Link2,
  ListChecks,
  Mail,
  Paperclip,
  Repeat,
  Type,
  type LucideIcon,
} from "lucide-react";

import type { PropertyFormat } from "@/api/types";

/**
 * The one glyph per property format. The add-property cards and the table's
 * header fallback read this map, so a format never has two drawings.
 */
export const FORMAT_ICONS: Record<PropertyFormat, LucideIcon> = {
  text: Type,
  number: Hash,
  checkbox: CheckSquare,
  date: Calendar,
  datetime: CalendarClock,
  select: CircleDot,
  multi_select: ListChecks,
  url: Link2,
  email: Mail,
  relation: Link,
  recurrence: Repeat,
  file: File,
  image: Image,
  attachments: Paperclip,
  list: ListChecks,
};
