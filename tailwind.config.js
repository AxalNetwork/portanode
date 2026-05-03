module.exports = {
  content: [
    "./_layouts/**/*.html",
    "./_includes/**/*.html",
    "./_modules/**/*.{md,html}",
    "./_stacks/**/*.{md,html}",
    "./_use_cases/**/*.{md,html}",
    "./_legal/**/*.{md,html}",
    "./_posts/**/*.{md,html}",
    "./*.{md,html}",
    "./pages/**/*.{md,html}",
  ],
  safelist: [
    "bg-axal-purple",
    "bg-axal-purple-light",
    "text-axal-purple",
    "text-axal-purple-light",
    "border-axal-purple",
  ],
  theme: {
    extend: {
      colors: {
        axal: {
          purple: "#6B21A8",
          "purple-light": "#A855F7",
          "purple-lighter": "#C084FC",
          ink: "#0B0B0F",
          paper: "#FAFAF7",
          gray: "#6B7280",
          "gray-50": "#F4F4F1",
          "gray-100": "#E5E5E0",
          "gray-200": "#C9C9C2",
          "gray-700": "#3A3A40",
        },
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      maxWidth: {
        prose: "68ch",
        page: "1200px",
      },
      borderRadius: {
        card: "14px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(11,11,15,0.04), 0 8px 24px rgba(11,11,15,0.06)",
        ring: "0 0 0 3px rgba(168,85,247,0.35)",
      },
    },
  },
  plugins: [],
};
