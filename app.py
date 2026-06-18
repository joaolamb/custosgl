from flask import Flask, render_template, request, jsonify
import pandas as pd
from io import BytesIO
from contextlib import contextmanager
from datetime import datetime
import sqlite3
import json
import re
import math
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'custos-dashboard-secret-2025')

DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data.db'))

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static')


@app.context_processor
def inject_static_version():
    """Cache-buster baseado no mtime mais recente dos arquivos em static/.
    Sempre que CSS ou JS muda, a URL muda e o navegador busca a versão nova."""
    latest = 0
    try:
        for root, _dirs, files in os.walk(STATIC_DIR):
            for f in files:
                try:
                    t = int(os.path.getmtime(os.path.join(root, f)))
                    if t > latest:
                        latest = t
                except OSError:
                    pass
    except OSError:
        pass
    return {'static_version': latest}


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db():
    with db() as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS months (
                month_year   TEXT PRIMARY KEY,
                payload      TEXT    NOT NULL,
                client_count INTEGER NOT NULL,
                created_at   TEXT    NOT NULL,
                updated_at   TEXT    NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS groups (
                cnpj_norm  TEXT PRIMARY KEY,
                grupo      TEXT NOT NULL,
                empresa    TEXT NOT NULL,
                cidade     TEXT,
                updated_at TEXT NOT NULL
            )
        ''')
        conn.execute('CREATE INDEX IF NOT EXISTS idx_groups_grupo ON groups(grupo)')


def norm_cnpj(s) -> str:
    """
    Mantém apenas dígitos. Quando vier com 12-13 dígitos é o Excel comendo o
    zero à esquerda do CNPJ (célula numérica), então faz pad à esquerda com
    zeros até 14. CPF (11) e CNPJ completo (14) ficam intactos.
    """
    d = re.sub(r'\D', '', str(s or ''))
    if 12 <= len(d) <= 13:
        d = d.zfill(14)
    return d


def save_groups(items: list[dict]) -> int:
    """Substitui todos os grupos. items: [{cnpj, grupo, empresa, cidade}]"""
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with db() as conn:
        conn.execute('DELETE FROM groups')
        conn.executemany(
            'INSERT OR REPLACE INTO groups(cnpj_norm, grupo, empresa, cidade, updated_at) VALUES (?,?,?,?,?)',
            [(norm_cnpj(it['cnpj']), it['grupo'], it['empresa'], it.get('cidade', ''), now)
             for it in items if norm_cnpj(it['cnpj'])]
        )
        return conn.total_changes


def get_groups_map() -> dict[str, dict]:
    """{cnpj_norm: {grupo, empresa, cidade}} — re-normaliza pra cobrir CNPJs
    salvos antes do fix de zero à esquerda."""
    with db() as conn:
        rows = conn.execute('SELECT cnpj_norm, grupo, empresa, cidade FROM groups').fetchall()
        return {norm_cnpj(r['cnpj_norm']): {'grupo': r['grupo'], 'empresa': r['empresa'], 'cidade': r['cidade']} for r in rows}


def get_groups_grouped() -> dict:
    """{grupo_name: [{cnpj, empresa, cidade}, ...]}"""
    with db() as conn:
        rows = conn.execute('SELECT grupo, cnpj_norm, empresa, cidade FROM groups ORDER BY grupo, empresa').fetchall()
    out = {}
    for r in rows:
        out.setdefault(r['grupo'], []).append({
            'cnpj': norm_cnpj(r['cnpj_norm']),  # padded a 14 dígitos
            'empresa': r['empresa'],
            'cidade': r['cidade'],
        })
    return out


def save_month(month_year: str, payload: dict) -> None:
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with db() as conn:
        conn.execute('''
            INSERT INTO months (month_year, payload, client_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(month_year) DO UPDATE SET
                payload      = excluded.payload,
                client_count = excluded.client_count,
                updated_at   = excluded.updated_at
        ''', (month_year, json.dumps(payload), len(payload.get('clients', [])), now, now))


def enrich_with_filial(clients: list[dict]) -> list[dict]:
    """
    Marca filiais quando múltiplos clientes compartilham a raiz do CNPJ
    (primeiros 8 dígitos). Como o honorário é faturado no CNPJ matriz,
    filiais aparecem com honorário 0 mas têm custo operacional. Para cada
    raiz com 2+ clientes:
      - matriz = CNPJ que termina em /0001 (padrão Receita Federal),
                 ou fallback o de maior honorário
      - demais = filiais (recebem is_filial + matriz_nome/doc)
    """
    by_raiz = {}
    for c in clients:
        cnpj = re.sub(r'\D', '', str(c.get('doc', '')))
        if len(cnpj) == 14:
            by_raiz.setdefault(cnpj[:8], []).append((c, cnpj))

    for group in by_raiz.values():
        if len(group) < 2:
            continue
        matriz = next((c for c, cnpj in group if cnpj[8:12] == '0001'), None)
        if matriz is None:
            matriz = max((c for c, _ in group), key=lambda c: c.get('honorario', 0))
        for c, _ in group:
            if c is matriz:
                c['is_matriz'] = True
            else:
                c['is_filial'] = True
                c['matriz_nome'] = matriz['nome']
                c['matriz_doc'] = matriz.get('doc', '')
    return clients


def get_month(month_year: str):
    with db() as conn:
        row = conn.execute('SELECT payload FROM months WHERE month_year = ?', (month_year,)).fetchone()
        if not row:
            return None
        data = json.loads(row['payload'])
        enrich_with_filial(data.get('clients', []))
        return data


def list_months() -> list[str]:
    with db() as conn:
        rows = conn.execute('SELECT month_year FROM months ORDER BY month_year').fetchall()
        return [r['month_year'] for r in rows]


def get_all_months() -> dict:
    with db() as conn:
        rows = conn.execute('SELECT month_year, payload FROM months ORDER BY month_year').fetchall()
        out = {}
        for r in rows:
            data = json.loads(r['payload'])
            enrich_with_filial(data.get('clients', []))
            out[r['month_year']] = data
        return out


def delete_month_db(month_year: str) -> bool:
    with db() as conn:
        cur = conn.execute('DELETE FROM months WHERE month_year = ?', (month_year,))
        return cur.rowcount > 0


def safe_float(val):
    try:
        v = float(val)
        return 0.0 if math.isnan(v) or math.isinf(v) else v
    except Exception:
        return 0.0


def _build_col_map(header_row) -> dict:
    """Map normalized header text -> column index. Case-insensitive, accent-tolerant."""
    import unicodedata
    def norm(s):
        s = unicodedata.normalize('NFD', str(s))
        s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
        return s.strip().lower()

    out = {}
    for i, val in enumerate(header_row):
        if pd.isna(val):
            continue
        out[norm(val)] = i
    return out


def _find_col(col_map: dict, *aliases) -> int | None:
    for a in aliases:
        key = a.strip().lower()
        if key in col_map:
            return col_map[key]
    return None


def parse_excel(file_bytes: bytes) -> list[dict]:
    """
    Lê planilha de custos. Detecta cabeçalho dinamicamente para suportar
    os dois layouts:
      - 2025: Código, Cliente, Nº Atividades, Custo Fixo, Custo Operacional,
              Total, Honorário, Extra, Imposto, Margem, Resultado, Percentual
      - 2026+: igual mas com 'Custo Total', 'Vlr Margem', NOVA 'Margem (%)',
               Resultado, 'Resultado (%)' (este como número, ex. 3.09 em vez
               do antigo 0.0309)
    """
    df = pd.read_excel(BytesIO(file_bytes), header=None, engine='openpyxl')
    if len(df) < 2:
        return []

    cm = _build_col_map(df.iloc[0])

    c_codigo = _find_col(cm, 'codigo', 'código')
    c_nome   = _find_col(cm, 'cliente')
    c_ativ   = _find_col(cm, 'nº atividades', 'n atividades', 'no atividades', 'numero atividades')
    c_cfixo  = _find_col(cm, 'custo fixo')
    c_coper  = _find_col(cm, 'custo operacional')
    c_ctotal = _find_col(cm, 'custo total', 'total')              # renomeado em 2026
    c_hon    = _find_col(cm, 'honorario', 'honorário')
    c_extra  = _find_col(cm, 'extra')
    c_imp    = _find_col(cm, 'imposto')
    c_margem = _find_col(cm, 'vlr margem', 'margem')              # renomeado em 2026
    c_mpct   = _find_col(cm, 'margem (%)', 'margem %', 'margem(%)')  # novo em 2026
    c_res    = _find_col(cm, 'resultado')
    c_pct    = _find_col(cm, 'resultado (%)', 'resultado %', 'resultado(%)', 'percentual')

    if c_nome is None or c_ativ is None or c_res is None:
        raise ValueError('Planilha sem cabeçalho esperado (Cliente, Nº Atividades, Resultado).')

    # Detecta esquema novo pela presença de "Margem (%)". No esquema novo o
    # percentual vem como número (3.09); no antigo vem como decimal (0.0309).
    is_new_schema = c_mpct is not None

    def cell(row, idx):
        return safe_float(row.iloc[idx]) if idx is not None else 0.0

    clients = []
    for i in range(1, len(df)):
        row = df.iloc[i]

        nome_raw = row.iloc[c_nome]
        if pd.isna(nome_raw):
            continue
        nome_raw = str(nome_raw).strip()
        if not nome_raw or nome_raw.lower() == 'nan':
            continue

        try:
            num_ativ = int(float(row.iloc[c_ativ]))
        except Exception:
            continue  # pula totais / linhas vazias

        m = re.match(r'^(.*?)\s*\(([^)]+)\)\s*$', nome_raw)
        nome, doc = (m.group(1).strip(), m.group(2).strip()) if m else (nome_raw, '')

        codigo = ''
        if c_codigo is not None:
            raw = str(row.iloc[c_codigo]).strip()
            if raw and raw.lower() != 'nan':
                try:
                    codigo = str(int(float(raw)))
                except Exception:
                    codigo = raw

        pct_raw  = cell(row, c_pct)
        mpct_raw = cell(row, c_mpct)
        # Normaliza para decimal (frontend usa fmt.pct que multiplica por 100)
        percentual = pct_raw / 100.0 if is_new_schema else pct_raw
        margem_pct = mpct_raw / 100.0

        clients.append({
            'codigo': codigo,
            'nome': nome,
            'doc': doc,
            'num_atividades': num_ativ,
            'custo_fixo': cell(row, c_cfixo),
            'custo_operacional': cell(row, c_coper),
            'total_custo': cell(row, c_ctotal),
            'honorario': cell(row, c_hon),
            'extra': cell(row, c_extra),
            'imposto': cell(row, c_imp),
            'margem_col': cell(row, c_margem),     # valor R$ da comissão
            'margem_pct': margem_pct,              # comissão / honorário (decimal)
            'resultado': cell(row, c_res),
            'percentual': percentual,              # resultado / honorário (decimal)
        })

    return clients


def compute_summary(clients: list[dict]) -> dict:
    total_hon = sum(c['honorario'] for c in clients)
    total_extra = sum(c['extra'] for c in clients)
    receita = total_hon + total_extra
    total_imp = sum(c['imposto'] for c in clients)
    total_custo = sum(c['total_custo'] for c in clients)
    total_margem = sum(c['margem_col'] for c in clients)
    total_res = sum(c['resultado'] for c in clients)
    total_ativ = sum(c['num_atividades'] for c in clients)

    custo_med = total_custo / total_ativ if total_ativ > 0 else 0
    margem_pct = total_res / total_hon if total_hon > 0 else 0
    margem_comissao_pct = total_margem / total_hon if total_hon > 0 else 0

    pos = sum(1 for c in clients if c['resultado'] > 0)
    neg = sum(1 for c in clients if c['resultado'] < 0)
    zero = sum(1 for c in clients if c['resultado'] == 0 and c['num_atividades'] == 0)
    sem_hon = sum(1 for c in clients if c['honorario'] == 0 and c['total_custo'] > 0)

    return {
        'honorarios_totais': round(total_hon, 2),
        'extras_totais': round(total_extra, 2),
        'receita_bruta': round(receita, 2),
        'impostos': round(total_imp, 2),
        'custo_total': round(total_custo, 2),
        'vlr_margem_total': round(total_margem, 2),
        'margem_comissao_pct': round(margem_comissao_pct, 6),
        'resultado_final': round(total_res, 2),
        'margem_pct': round(margem_pct, 6),
        'num_atividades': total_ativ,
        'custo_medio_atividade': round(custo_med, 2),
        'clientes_positivos': pos,
        'clientes_negativos': neg,
        'clientes_zerados': zero,
        'clientes_sem_honorario': sem_hon,
        'total_clientes': len(clients),
    }


def parse_groups_xlsx(file_bytes: bytes) -> list[dict]:
    """
    Lê GRUPOS.xlsx com cabeçalho: 'GRUPO - EMPRESA' | 'CNPJ' | 'CIDADE'.
    Quebra o nome em (grupo, empresa) usando o primeiro separador ' - ' (ou '- ').
    """
    df = pd.read_excel(BytesIO(file_bytes), header=0, engine='openpyxl')
    df.columns = [str(c).strip().upper() for c in df.columns]

    col_combo = next((c for c in df.columns if 'GRUPO' in c and 'EMPRESA' in c), df.columns[0])
    col_cnpj  = next((c for c in df.columns if 'CNPJ' in c), df.columns[1] if len(df.columns) > 1 else None)
    col_cidade = next((c for c in df.columns if 'CIDADE' in c), df.columns[2] if len(df.columns) > 2 else None)

    out = []
    for _, row in df.iterrows():
        raw = row.get(col_combo)
        if pd.isna(raw):
            continue
        s = re.sub(r'\s+', ' ', str(raw)).strip()
        if ' - ' in s:
            grupo, empresa = s.split(' - ', 1)
        elif '- ' in s:
            grupo, empresa = s.split('- ', 1)
        else:
            continue
        cnpj = '' if col_cnpj is None or pd.isna(row[col_cnpj]) else str(row[col_cnpj]).strip()
        cidade = '' if col_cidade is None or pd.isna(row[col_cidade]) else str(row[col_cidade]).strip()
        if not norm_cnpj(cnpj):
            continue
        out.append({
            'grupo': grupo.strip(),
            'empresa': empresa.strip(),
            'cnpj': cnpj,
            'cidade': cidade,
        })
    return out


DEMO_FILE = os.path.join(os.path.dirname(__file__), 'demo_data.xlsx')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/demo')
def demo():
    """Pre-load demo data from local demo_data.xlsx if it exists."""
    if not os.path.exists(DEMO_FILE):
        return jsonify({'error': 'Demo file not found'}), 404
    with open(DEMO_FILE, 'rb') as f:
        file_bytes = f.read()
    clients = parse_excel(file_bytes)
    summary = compute_summary(clients)
    save_month('2025-01', {'month_year': '2025-01', 'clients': clients, 'summary': summary})
    return jsonify({'success': True, 'client_count': len(clients)})


@app.route('/api/upload', methods=['POST'])
def upload():
    if 'file' not in request.files:
        return jsonify({'error': 'Arquivo não encontrado'}), 400

    file = request.files['file']
    month_year = request.form.get('month_year', '').strip()

    if not month_year:
        return jsonify({'error': 'Mês de referência não informado'}), 400

    try:
        file_bytes = file.read()
        clients = parse_excel(file_bytes)

        if not clients:
            return jsonify({'error': 'Nenhum cliente encontrado na planilha'}), 400

        summary = compute_summary(clients)
        payload = {'month_year': month_year, 'clients': clients, 'summary': summary}
        save_month(month_year, payload)

        return jsonify({
            'success': True,
            'month_year': month_year,
            'client_count': len(clients),
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({'error': f'Erro ao processar arquivo: {str(e)}'}), 500


@app.route('/api/months')
def get_months():
    return jsonify(list_months())


@app.route('/api/data/<path:month_year>')
def get_data(month_year):
    data = get_month(month_year)
    if data is None:
        return jsonify({'error': 'Dados não encontrados'}), 404
    return jsonify(data)


@app.route('/api/all')
def get_all():
    return jsonify(get_all_months())


@app.route('/api/groups/upload', methods=['POST'])
def upload_groups():
    if 'file' not in request.files:
        return jsonify({'error': 'Arquivo não encontrado'}), 400
    try:
        items = parse_groups_xlsx(request.files['file'].read())
        if not items:
            return jsonify({'error': 'Nenhum grupo encontrado na planilha'}), 400
        n = save_groups(items)
        grupos = sorted({it['grupo'] for it in items})
        return jsonify({'success': True, 'count': len(items), 'grupos': len(grupos), 'changes': n})
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({'error': f'Erro ao processar grupos: {str(e)}'}), 500


@app.route('/api/groups')
def list_groups():
    return jsonify(get_groups_grouped())


@app.route('/api/groups/empresa', methods=['POST'])
def upsert_empresa_in_group():
    """Cria ou atualiza uma empresa em um grupo. Body: {cnpj, grupo, empresa, cidade?}"""
    body = request.get_json(silent=True) or {}
    cnpj = norm_cnpj(body.get('cnpj', ''))
    grupo = (body.get('grupo') or '').strip()
    empresa = (body.get('empresa') or '').strip()
    cidade = (body.get('cidade') or '').strip()
    if len(cnpj) != 14:
        return jsonify({'error': 'CNPJ inválido (precisa de 14 dígitos)'}), 400
    if not grupo or not empresa:
        return jsonify({'error': 'grupo e empresa são obrigatórios'}), 400
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with db() as conn:
        conn.execute('''
            INSERT INTO groups (cnpj_norm, grupo, empresa, cidade, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(cnpj_norm) DO UPDATE SET
                grupo = excluded.grupo,
                empresa = excluded.empresa,
                cidade = excluded.cidade,
                updated_at = excluded.updated_at
        ''', (cnpj, grupo, empresa, cidade, now))
    return jsonify({'success': True, 'cnpj': cnpj, 'grupo': grupo, 'empresa': empresa})


@app.route('/api/groups/empresa/<cnpj>', methods=['DELETE'])
def remove_empresa_from_group(cnpj):
    cn = norm_cnpj(cnpj)
    with db() as conn:
        cur = conn.execute('DELETE FROM groups WHERE cnpj_norm = ?', (cn,))
        if cur.rowcount == 0:
            return jsonify({'error': 'CNPJ não encontrado em nenhum grupo'}), 404
    return jsonify({'success': True, 'cnpj': cn})


@app.route('/api/groups/rename', methods=['POST'])
def rename_group():
    """Renomeia um grupo (atualiza todas as empresas). Body: {old_name, new_name}"""
    body = request.get_json(silent=True) or {}
    old_name = (body.get('old_name') or '').strip()
    new_name = (body.get('new_name') or '').strip()
    if not old_name or not new_name:
        return jsonify({'error': 'old_name e new_name são obrigatórios'}), 400
    if old_name == new_name:
        return jsonify({'success': True, 'changes': 0})
    now = datetime.utcnow().isoformat(timespec='seconds') + 'Z'
    with db() as conn:
        cur = conn.execute('UPDATE groups SET grupo = ?, updated_at = ? WHERE grupo = ?',
                           (new_name, now, old_name))
        if cur.rowcount == 0:
            return jsonify({'error': 'Grupo não encontrado'}), 404
    return jsonify({'success': True, 'changes': cur.rowcount})


@app.route('/api/groups/by_name/<path:name>', methods=['DELETE'])
def delete_group_by_name(name):
    """Remove um grupo inteiro (e todas suas empresas vinculadas)."""
    with db() as conn:
        cur = conn.execute('DELETE FROM groups WHERE grupo = ?', (name,))
        if cur.rowcount == 0:
            return jsonify({'error': 'Grupo não encontrado'}), 404
    return jsonify({'success': True, 'removed': cur.rowcount})


@app.route('/api/groups/<path:month_year>')
def group_analysis(month_year):
    """Retorna clientes do mês enriquecidos com 'grupo'. Frontend agrega."""
    data = get_month(month_year)
    if data is None:
        return jsonify({'error': 'Mês não encontrado'}), 404
    gmap = get_groups_map()
    enriched = []
    for c in data.get('clients', []):
        cn = norm_cnpj(c.get('doc'))
        g = gmap.get(cn)
        if g:
            enriched.append({**c, 'grupo': g['grupo'], 'grupo_cidade': g.get('cidade', '')})
    return jsonify({
        'month_year': month_year,
        'clients_in_groups': enriched,
        'unmatched_cnpjs': [cn for cn in gmap if not any(norm_cnpj(c.get('doc')) == cn for c in data.get('clients', []))][:20],
    })


@app.route('/api/month/<path:month_year>', methods=['DELETE'])
def remove_month(month_year):
    ok = delete_month_db(month_year)
    if not ok:
        return jsonify({'error': 'Mês não encontrado'}), 404
    return jsonify({'success': True, 'month_year': month_year})


# Initialize DB on import (works under WSGI on PythonAnywhere too)
init_db()


if __name__ == '__main__':
    import sys
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 5050))
    app.run(debug=True, port=port)
