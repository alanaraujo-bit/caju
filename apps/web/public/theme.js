try {
  const theme = localStorage.getItem("caju-theme");
  if (["claro", "escuro", "areia", "cafe"].includes(theme))
    document.documentElement.dataset.theme = theme;
} catch {}
