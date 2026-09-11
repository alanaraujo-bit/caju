import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
test("empresa, configurações, contato, retorno, temas e sessão funcionam de ponta a ponta", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const email = `qa-${randomUUID()}@example.test`,
    password = "Senha exclusiva do teste 2026!";
  await mkdir(".impeccable/review", { recursive: true });
  await page.goto("/entrar");
  await page.getByRole("heading", { name: "Bom ter você por aqui." }).waitFor();
  await page.screenshot({
    path: `.impeccable/review/login-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("link", { name: "Criar sua conta" }).click();
  await page.getByLabel("Seu nome", { exact: true }).fill("Ana Oliveira");
  await page.getByLabel("Nome da empresa").fill("Empresa de validação");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Criar minha empresa" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: `.impeccable/review/${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("link", { name: /Cada assunto no lugar certo/ }).click();
  await page
    .getByRole("button", { name: "Criar departamento", exact: true })
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("Comercial");
  await page
    .getByLabel("Descrição (opcional)")
    .fill("Vendas e orientação de produtos");
  await page.getByRole("button", { name: "Salvar departamento" }).click();
  await expect(
    page.getByRole("heading", { name: "Comercial", exact: true }),
  ).toBeVisible();
  await page.goto("/configuracoes/horarios");
  await page
    .getByRole("heading", { name: "Horário de atendimento", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Alterações salvas")).toBeVisible();
  await page.goto("/configuracoes/etiquetas");
  await page.getByRole("button", { name: "Nova etiqueta" }).click();
  await page.getByLabel("Nome da etiqueta").fill("Cliente recorrente");
  await page.getByLabel("Cor", { exact: true }).selectOption("violet");
  await page.getByRole("button", { name: "Criar etiqueta" }).click();
  await expect(
    page.getByText("Cliente recorrente", { exact: true }),
  ).toBeVisible();
  await page.goto("/contatos/novo");
  await page.getByLabel("Nome", { exact: true }).fill("Marina Santos");
  await page.getByLabel("WhatsApp", { exact: true }).fill("+55 11 99999-1111");
  await page
    .getByLabel("Observações internas")
    .fill("Prefere receber informações à tarde.");
  await page.getByLabel("Cliente recorrente").check();
  await page.getByRole("button", { name: "Adicionar contato" }).click();
  await expect(
    page.getByRole("heading", { name: "Marina Santos", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Marcar retorno", exact: true })
    .click();
  const due = new Date(Date.now() + 2 * 86400000);
  const local = new Date(due.getTime() - due.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Quando retornar").fill(local);
  await page
    .getByLabel("O que você precisa fazer?")
    .fill("Confirmar se recebeu o orçamento");
  await page.getByRole("button", { name: "Salvar retorno" }).click();
  await expect(page).toHaveURL(/retornos/);
  await page.getByRole("tab", { name: /Próximos/ }).click();
  await expect(
    page.getByRole("heading", { name: "Marina Santos" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Concluir", exact: true }).click();
  await page.getByRole("tab", { name: /Concluídos/ }).click();
  await expect(
    page.getByRole("button", { name: "Reabrir", exact: true }),
  ).toBeVisible();
  await page.goto("/respostas/nova");
  await page.getByLabel("Título", { exact: true }).fill("Nosso horário");
  await page.getByLabel("Atalho", { exact: true }).fill("horarios");
  await page
    .getByLabel("Mensagem", { exact: true })
    .fill("Olá! Nosso atendimento é de segunda a sexta, das 8h às 18h.");
  await page.getByRole("button", { name: "Salvar resposta" }).click();
  await expect(
    page.getByRole("heading", { name: "Nosso horário" }),
  ).toBeVisible();
  await page.goto("/contatos");
  await page.getByRole("textbox", { name: "Buscar contatos" }).fill("Marina");
  await expect(
    page.getByRole("link", { name: /Marina Santos/ }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: `.impeccable/review/contacts-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("link", { name: /Marina Santos/ })
    .first()
    .click();
  await page.getByLabel("Nome", { exact: true }).fill("Não salvar");
  await page.getByRole("link", { name: "Voltar", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Sair sem salvar", exact: true })
    .click();
  await expect(page).toHaveURL(/contatos$/);
  await page.goto("/configuracoes/aparencia");
  for (const [label, id] of [
    ["Caju escuro", "escuro"],
    ["Areia", "areia"],
    ["Café", "cafe"],
    ["Caju claro", "claro"],
  ]) {
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", id);
    await page.screenshot({
      path: `.impeccable/review/theme-${id}-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "claro");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Abrir navegação" }).click();
  await page
    .getByRole("button", { name: "Sair da conta", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sair da conta" })
    .click();
  await expect(page).toHaveURL(/entrar/);
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar no Caju" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana." })).toBeVisible();
  expect(errors).toEqual([]);
});
