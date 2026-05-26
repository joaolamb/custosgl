from flask import Flask, render_template, request, jsonify, session
import pandas as pd
from io import BytesIO
import re
import uuid
import math
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'custos-dashboard-secret-2025')

DATA_STORE: dict = {}


def get_sid():
    if 'sid' not in session:
        session['sid'] = str(uuid.uuid4())
    return session['sid']


def safe_float(val):
    try:
        v = float(val)
        return 0.0 if math.isnan(v) or math.isinf(v) else v
    except Exception:
        return 0.0


def parse_excel(file_bytes: bytes) -> list[dict]:
    df = pd.read_excel(BytesIO(file_bytes), header=None, engine='openpyxl')
    clients = []

    for i in range(1, len(df)):
        row = df.iloc[i]

        nome_raw = row.iloc[2]
        if pd.isna(nome_raw):
            continue
        nome_raw = str(nome_raw).strip()
        if not nome_raw or nome_raw.lower() == 'nan':
            continue

        try:
            num_ativ = int(float(row.iloc[3]))
        except Exception:
            continue  # skip totals and empty rows

        m = re.match(r'^(.*?)\s*\(([^)]+)\)\s*$', nome_raw)
        if m:
            nome, doc = m.group(1).strip(), m.group(2).strip()
        else:
            nome, doc = nome_raw, ''

        codigo = str(row.iloc[1]).strip()
        if codigo.lower() in ('nan', ''):
            codigo = ''
        else:
            try:
                codigo = str(int(float(codigo)))
            except Exception:
                pass

        clients.append({
            'codigo': codigo,
            'nome': nome,
            'doc': doc,
            'num_atividades': num_ativ,
            'custo_fixo': safe_float(row.iloc[4]),
            'custo_operacional': safe_float(row.iloc[5]),
            'total_custo': safe_float(row.iloc[6]),
            'honorario': safe_float(row.iloc[7]),
            'extra': safe_float(row.iloc[8]),
            'imposto': safe_float(row.iloc[9]),
            'margem_col': safe_float(row.iloc[10]),
            'resultado': safe_float(row.iloc[11]),
            'percentual': safe_float(row.iloc[12]),
        })

    return clients


def compute_summary(clients: list[dict]) -> dict:
    total_hon = sum(c['honorario'] for c in clients)
    total_extra = sum(c['extra'] for c in clients)
    receita = total_hon + total_extra
    total_imp = sum(c['imposto'] for c in clients)
    total_custo = sum(c['total_custo'] for c in clients)
    total_res = sum(c['resultado'] for c in clients)
    total_ativ = sum(c['num_atividades'] for c in clients)

    custo_med = total_custo / total_ativ if total_ativ > 0 else 0
    margem_pct = total_res / total_hon if total_hon > 0 else 0

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


DEMO_FILE = os.path.join(os.path.dirname(__file__), 'demo_data.xlsx')


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/demo')
def demo():
    """Pre-load demo data from local demo_data.xlsx if it exists."""
    if not os.path.exists(DEMO_FILE):
        return jsonify({'error': 'Demo file not found'}), 404
    sid = get_sid()
    with open(DEMO_FILE, 'rb') as f:
        file_bytes = f.read()
    clients = parse_excel(file_bytes)
    summary = compute_summary(clients)
    if sid not in DATA_STORE:
        DATA_STORE[sid] = {}
    DATA_STORE[sid]['2025-01'] = {'month_year': '2025-01', 'clients': clients, 'summary': summary}
    return jsonify({'success': True, 'client_count': len(clients)})


@app.route('/api/upload', methods=['POST'])
def upload():
    sid = get_sid()

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

        if sid not in DATA_STORE:
            DATA_STORE[sid] = {}

        DATA_STORE[sid][month_year] = {
            'month_year': month_year,
            'clients': clients,
            'summary': summary,
        }

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
    sid = get_sid()
    if sid not in DATA_STORE:
        return jsonify([])
    return jsonify(sorted(DATA_STORE[sid].keys()))


@app.route('/api/data/<path:month_year>')
def get_data(month_year):
    sid = get_sid()
    if sid not in DATA_STORE or month_year not in DATA_STORE[sid]:
        return jsonify({'error': 'Dados não encontrados'}), 404
    return jsonify(DATA_STORE[sid][month_year])


@app.route('/api/all')
def get_all():
    sid = get_sid()
    if sid not in DATA_STORE:
        return jsonify({})
    return jsonify(DATA_STORE[sid])


if __name__ == '__main__':
    import sys
    port = int(os.environ.get('PORT', sys.argv[1] if len(sys.argv) > 1 else 5050))
    app.run(debug=True, port=port)
