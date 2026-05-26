# Dashboard de Custos — GL Inteligência Contábil

Dashboard web para análise de rentabilidade por cliente, alimentado por planilhas mensais de custos (.xlsx).

## Stack
- **Backend:** Python 3 + Flask
- **Frontend:** HTML, CSS, JavaScript vanilla + Chart.js 4.4
- **Parsing:** pandas + openpyxl
- **Tipografia:** Geist + Geist Mono
- **Cores:** #002749 (primário), #b02228 (vermelho), branco/preto

## Como rodar localmente

```bash
./run.sh
# ou
pip3 install -r requirements.txt
python3 app.py
```

Abra http://localhost:5050 no navegador. Use o botão **+ Mês** para carregar uma planilha.

Variável de ambiente `PORT` configura a porta (padrão 5050).

## Estrutura

```
.
├── app.py                  # Flask backend + parsing da planilha
├── requirements.txt
├── run.sh                  # Script de inicialização
├── templates/index.html    # Página única (SPA)
└── static/
    ├── css/style.css       # Design system
    ├── js/app.js           # Toda a lógica de dashboard
    └── img/logo_gl.png     # Logo da empresa
```

## Layout da planilha esperado

Linha 0 = cabeçalho. Colunas (0-indexed):

| # | Coluna             | Descrição                          |
|---|--------------------|------------------------------------|
| 1 | Código             | Código interno do cliente          |
| 2 | Cliente            | Nome (CNPJ ou CPF entre parênteses)|
| 3 | Nº Atividades      | Número de atividades no mês        |
| 4 | Custo Fixo         |                                    |
| 5 | Custo Operacional  |                                    |
| 6 | Total              | Custo total (fixo + operacional)   |
| 7 | Honorário          | Receita fixa                       |
| 8 | Extra              | Receita variável                   |
| 9 | Imposto            |                                    |
| 10| Margem             | Comissão interna                   |
| 11| Resultado          | Hon + Extra − Imp − Custo − Margem |
| 12| Percentual         | Resultado ÷ Honorário              |

## Funcionalidades

### Abas
- **Visão Geral** — 12 KPI cards + composição da carteira + tops 10 positivos/negativos
- **Rentabilidade** — Ranking de prejuízo, honorário vs extra, margem %, balanço positivos/negativos
- **Custos & Atividades** — Top 20 custo, top 15 atividades, custo/atividade, concentração ABC, histograma
- **Alertas** — Críticos, deficitários, sem honorário, baixa margem (< 32%), alto volume, alto custo/atividade, saudáveis (≥ 32%)
- **Análise Individual** — Busca de cliente + diagnóstico textual + cards + comparação com média
- **Comparativo Mensal** — Evolução mês a mês (carteira ou cliente individual)

### Threshold de saudabilidade
Margem ≥ **32%** = cliente saudável. Abaixo disso entra em alerta de baixa margem.

## Notas
- Dados são armazenados em memória do servidor (`DATA_STORE`) por sessão. Reiniciar perde os dados — usuários precisam recarregar as planilhas.
- Planilhas reais (com CNPJ e dados financeiros) **nunca** devem ser commitadas. O `.gitignore` já bloqueia `*.xlsx` e `demo_data.xlsx`.
