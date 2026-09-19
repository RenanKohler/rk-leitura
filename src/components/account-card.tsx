"use client";

import { useState } from "react";
import { apiSend } from "@/lib/client";
import { useAuth, useToast } from "@/components/providers";
import { Alert, Button, Card, Field, SectionTitle, Sheet } from "@/components/ui";
import { LogoutIcon, TrashIcon } from "@/components/icons";

const MIN_PASSWORD_LENGTH = 8;
const MAX_NAME_LENGTH = 80;

interface AccountUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Secao "Conta" dos ajustes: nome, senha, sair e excluir.
 *
 * Fica em componente proprio porque concentra tres formularios com estado
 * independente; deixa-los soltos na tela de ajustes misturaria essa maquinaria
 * com os controles de leitura, que nao tem estado nenhum.
 */
export function AccountCard() {
  const { user, logout, setUser } = useAuth();
  const notify = useToast();

  const [name, setName] = useState(user?.name ?? "");
  const [savingName, setSavingName] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [signingOut, setSigningOut] = useState(false);

  const nameChanged = name.trim().length > 0 && name.trim() !== user?.name;

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!nameChanged || savingName) return;

    setSavingName(true);
    try {
      const { user: updated } = await apiSend<{ user: AccountUser }>("/api/auth/me", "PATCH", {
        name: name.trim(),
      });
      setUser(updated);
      notify("Nome atualizado.", "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Falha ao salvar.", "error");
    } finally {
      setSavingName(false);
    }
  };

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingPassword) return;

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(`A senha precisa ter ao menos ${MIN_PASSWORD_LENGTH} caracteres.`);
      return;
    }

    setPasswordError("");
    setSavingPassword(true);
    try {
      await apiSend("/api/auth/me", "PATCH", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      notify("Senha alterada.", "success");
    } catch (cause) {
      setPasswordError(cause instanceof Error ? cause.message : "Falha ao alterar a senha.");
    } finally {
      setSavingPassword(false);
    }
  };

  const confirmDelete = async () => {
    if (deleting) return;

    setDeleteError("");
    setDeleting(true);
    try {
      await apiSend("/api/auth/me", "DELETE", { password: deletePassword });
      void navigator.serviceWorker?.ready
        .then((registration) => registration.active?.postMessage({ type: "limpar" }))
        .catch(() => undefined);
      // Navegacao de pagina inteira de proposito, e nao `router.push`: a
      // conta acabou de deixar de existir, e o que precisa ser descartado e
      // justamente o estado do cliente que a navegacao interna preservaria.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/login";
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Falha ao excluir a conta.");
      setDeleting(false);
    }
  };

  return (
    <>
      <Card className="space-y-6 p-5">
        <SectionTitle>Conta</SectionTitle>

        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent">
            {user?.name?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{user?.name}</p>
            <p className="break-anywhere text-sm text-muted">{user?.email}</p>
          </div>
        </div>

        <form onSubmit={saveName} className="space-y-3">
          <Field
            label="Nome de exibicao"
            name="nome"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" variant="secondary" full loading={savingName} disabled={!nameChanged}>
            Salvar nome
          </Button>
        </form>

        <form onSubmit={savePassword} className="space-y-3">
          <p className="text-sm font-medium text-muted">Trocar senha</p>
          {passwordError ? <Alert>{passwordError}</Alert> : null}
          <Field
            label="Senha atual"
            name="senha-atual"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
          <Field
            label="Nova senha"
            name="senha-nova"
            type="password"
            autoComplete="new-password"
            hint={`Minimo de ${MIN_PASSWORD_LENGTH} caracteres.`}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Button
            type="submit"
            variant="secondary"
            full
            loading={savingPassword}
            disabled={currentPassword.length === 0 || newPassword.length === 0}
          >
            Alterar senha
          </Button>
        </form>

        <div className="space-y-2 border-t border-border pt-5">
          <Button
            variant="secondary"
            full
            loading={signingOut}
            onClick={() => {
              setSigningOut(true);
              void logout();
            }}
          >
            <LogoutIcon className="size-5" />
            Sair da conta
          </Button>

          <Button variant="ghost" full onClick={() => setConfirmingDelete(true)}>
            <TrashIcon className="size-5" />
            Excluir conta
          </Button>
        </div>
      </Card>

      <Sheet
        open={confirmingDelete}
        title="Excluir conta"
        onClose={() => {
          setConfirmingDelete(false);
          setDeletePassword("");
          setDeleteError("");
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Isto apaga em definitivo a sua conta, todos os textos da biblioteca e todo o historico
            de leitura. Nao ha como desfazer.
          </p>

          {deleteError ? <Alert>{deleteError}</Alert> : null}

          <Field
            label="Confirme com a sua senha"
            name="senha-exclusao"
            type="password"
            autoComplete="current-password"
            value={deletePassword}
            onChange={(event) => setDeletePassword(event.target.value)}
          />

          <Button
            variant="danger"
            size="lg"
            full
            loading={deleting}
            disabled={deletePassword.length === 0}
            onClick={confirmDelete}
          >
            Excluir a conta em definitivo
          </Button>
        </div>
      </Sheet>
    </>
  );
}
