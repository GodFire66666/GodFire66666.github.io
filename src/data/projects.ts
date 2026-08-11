export interface Project {
  title: string;
  description: string;
  details: string;
  href: string;
  image: string;
  imageAlt: string;
  tags: string[];
  featured?: boolean;
}

export const projects: Project[] = [
  {
    title: "Yucong's Tarot",
    description:
      "An interactive tarot reading experience designed for quiet reflection.",
    details:
      "Choose a single-card reading for daily guidance or a three-card spread to explore the past, present, and future. Designed and built independently from concept to deployment.",
    href: "https://yucongs-tarot.netlify.app/",
    image: "/projects/yucongs-tarot.jpg",
    imageAlt:
      "The dark purple and gold interface of Yucong's Tarot, showing single-card and three-card reading options",
    tags: ["Personal project", "Web experience", "Product design"],
    featured: true,
  },
];

export const featuredProject = projects.find((project) => project.featured);
