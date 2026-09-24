import { prisma } from '@/app/utils/prisma';


/**
 * Regista um evento na Linha do Tempo (Timeline) do CRM do Utilizador
 * @param userId ID do Utilizador (Cliente)
 * @param tipo Categoria do evento (ex: "SISTEMA", "FINANCEIRO", "MANUAL", "EMAIL")
 * @param titulo Título curto do que aconteceu
 * @param descricao Texto detalhado ou anotação do vendedor (Opcional)
 */
export async function registrarEventoCrm(userId: string, tipo: string, titulo: string, descricao?: string) {
    try {
        await prisma.userEvent.create({
            data: {
                userId,
                tipo,
                titulo,
                descricao
            }
        });
    } catch (error) {
        console.error("Falha ao registar evento CRM:", error);
    }
}
