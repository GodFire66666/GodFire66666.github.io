const tagTranslations: Record<string, string> = {
  life: "生活",
  methods: "方法",
  notes: "笔记",
  work: "工作",
};

export function translateTag(tag: string) {
  return tagTranslations[tag] ?? tag;
}

export function formatDateZh(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
