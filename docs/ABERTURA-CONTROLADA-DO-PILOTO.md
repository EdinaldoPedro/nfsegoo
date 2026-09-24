# Abertura controlada do piloto

O primeiro lançamento não deve abrir aquisição irrestrita. Configure `PUBLIC_REGISTRATION_MODE=CLOSED`: login, emissão e demais funções dos clientes existentes permanecem disponíveis, mas `/api/auth/cadastro` recusa novas solicitações antes de consumir rate limit, gravar pendência ou enviar e-mail. A tela explica que o piloto é acompanhado.

Em desenvolvimento, a ausência da variável mantém o cadastro aberto para facilitar testes. Em produção, ausência, erro de digitação ou valor desconhecido falham fechados. Somente `OPEN` abre o cadastro público.

## Ativação

1. Restaure e confira a base autorizada; elimine cadastros pendentes que não devam participar.
2. Mantenha `PUBLIC_REGISTRATION_MODE=CLOSED`, cobrança manual e modo de manutenção pronto para uso.
3. Execute todos os gates e abra tráfego apenas para os usuários existentes do piloto.
4. Acompanhe diariamente disponibilidade, filas, falhas fiscais, suporte, consumo de banco e certificados.
5. Não altere para `OPEN` durante o piloto. A abertura pública segue `SAIDA-DO-PILOTO-E-ABERTURA-PUBLICA.md` e exige evidência baseada no tráfego real.

## Reversão

- Incidente de segurança, isolamento, perda de documento, emissão duplicada ou divergência fiscal: ative manutenção, preserve evidências e siga o runbook de incidentes.
- Saturação ou fila crescente sem perda de integridade: mantenha login quando seguro, continue com cadastro fechado e pause novas ativações comerciais.
- Problema limitado à aquisição: mantenha `CLOSED`; usuários existentes não são desconectados.
- Reverter código não significa reverter banco. Migrações são avaliadas individualmente; nunca use `reset`, `db push` ou restauração sobre produção como atalho.

Fechar o cadastro não é controle de autorização interna e não substitui o isolamento por empresa. É apenas o limitador de entrada do piloto.
