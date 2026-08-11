export interface Project {
  title: string;
  titleZh: string;
  description: string;
  descriptionZh: string;
  details: string;
  detailsZh: string;
  href: string;
  image: string;
  imageAlt: string;
  tags: string[];
  tagsZh: string[];
  featured?: boolean;
}

export const projects: Project[] = [
  {
    title: "Yucong's Tarot",
    titleZh: "Yucong 的塔罗牌",
    description:
      "An interactive tarot reading experience designed for quiet reflection.",
    descriptionZh: "一个为安静思考而设计的交互式塔罗牌体验。",
    details:
      "Choose a single-card reading for daily guidance or a three-card spread to explore the past, present, and future. Designed and built independently from concept to deployment.",
    detailsZh:
      "你可以抽取单张牌获得今日指引，也可以用三张牌探索过去、现在与未来。这个项目从概念、视觉设计到开发部署均由我独立完成。",
    href: "https://yucongs-tarot.netlify.app/",
    image: "/projects/yucongs-tarot.jpg",
    imageAlt:
      "The dark purple and gold interface of Yucong's Tarot, showing single-card and three-card reading options",
    tags: ["Personal project", "Web experience", "Product design"],
    tagsZh: ["个人项目", "网页体验", "产品设计"],
    featured: true,
  },
];

export const featuredProject = projects.find((project) => project.featured);
