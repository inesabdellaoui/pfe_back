import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as nodemailer from 'nodemailer';
import * as fs   from 'fs';
import * as path from 'path';

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  async getKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(*)::int AS total_inspections,
        COUNT(*) FILTER (WHERE resultat = 'OK')::int  AS pieces_ok,
        COUNT(*) FILTER (WHERE resultat = 'NIO')::int AS pieces_nio,
        ROUND(
          COUNT(*) FILTER (WHERE resultat = 'NIO')::numeric
          / NULLIF(COUNT(*), 0) * 100, 2
        ) AS mdr
      FROM public.inspection
    `);
    const row = result[0];
    return {
      totalInspections: row.total_inspections,
      piecesOK:         row.pieces_ok,
      piecesNIO:        row.pieces_nio,
      mdr:              Number(row.mdr ?? 0),
    };
  }

  async getInspectionsTrend() {
    return this.dataSource.query(`
      SELECT
        TO_CHAR(date_inspection::date, 'DD/MM') AS date,
        COUNT(*) FILTER (WHERE resultat = 'OK')::int  AS ok,
        COUNT(*) FILTER (WHERE resultat = 'NIO')::int AS nio
      FROM public.inspection
      GROUP BY date_inspection::date
      ORDER BY date_inspection::date
    `);
  }

  async getTopLots() {
    return this.dataSource.query(`
      SELECT
        l.id_lot    AS lot,
        c.nom_client AS client,
        ROUND(
          COUNT(*) FILTER (WHERE i.resultat = 'NIO')::numeric
          / NULLIF(COUNT(*), 0) * 100, 2
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      JOIN public.piece p      ON p.id_lot    = l.id_lot
      JOIN public.inspection i ON i.id_piece  = p.id_piece
      GROUP BY l.id_lot, c.nom_client
      ORDER BY mdr DESC
      LIMIT 5
    `);
  }

  async getDefectsDistribution() {
    return this.dataSource.query(`
      SELECT d.type_defaut AS type, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      GROUP BY d.type_defaut
      ORDER BY total DESC
    `);
  }

  async getKpisFiltered(filters: any) {
    const { client, startDate, endDate } = filters;
    let where = 'WHERE 1=1';
    if (client)                  where += ` AND c.id_client = '${client}'`;
    if (startDate && endDate)    where += ` AND i.date_inspection BETWEEN '${startDate}' AND '${endDate}'`;

    const result = await this.dataSource.query(`
      SELECT
        COUNT(*)                                         AS total,
        COUNT(*) FILTER (WHERE i.resultat = 'OK')        AS ok,
        COUNT(*) FILTER (WHERE i.resultat = 'NIO')       AS nio
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      ${where}
    `);
    return result[0];
  }

  // ─── PERFORMANCES ────────────────────────────────────────────

  async getPerfKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(i.id_inspection) AS total_inspections,
        ROUND(
          COUNT(i.id_inspection)::numeric /
          NULLIF(EXTRACT(EPOCH FROM (MAX(i.date_inspection) - MIN(i.date_inspection)))/3600, 0)
        , 1) AS cadence_par_heure,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'OK' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS taux_conformite,
        ROUND(
          AVG(EXTRACT(EPOCH FROM (i.date_inspection - l.date_reception))/3600)::numeric
        , 1) AS delai_moyen_heures
      FROM public.inspection i
      JOIN public.piece p ON p.id_piece = i.id_piece
      JOIN public.lot l   ON l.id_lot   = p.id_lot
    `);
    return result[0];
  }

  async getPerfTrend() {
    return this.dataSource.query(`
      SELECT
        TO_CHAR(date_inspection, 'DD/MM')                    AS date,
        COUNT(*)                                              AS total,
        COUNT(CASE WHEN resultat = 'OK'  THEN 1 END)         AS ok,
        COUNT(CASE WHEN resultat = 'NIO' THEN 1 END)         AS nio
      FROM public.inspection
      GROUP BY TO_CHAR(date_inspection, 'DD/MM'), DATE_TRUNC('day', date_inspection)
      ORDER BY DATE_TRUNC('day', date_inspection) DESC
      LIMIT 14
    `);
  }

  async getPerfByClient() {
    return this.dataSource.query(`
      SELECT
        c.nom_client                                          AS client,
        COUNT(i.id_inspection)                                AS total,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)       AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)       AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      GROUP BY c.nom_client
      ORDER BY total DESC
    `);
  }

  async getPerfByOperatrice() {
  return this.dataSource.query(`
    SELECT
      o.prenom || ' ' || o.nom  AS operatrice,
      o.poste                   AS role,
      s.nb_inspections          AS total,
      s.nb_io                   AS ok,
      s.nb_nio                  AS nio,
      ROUND(
        s.nb_io::numeric /
        NULLIF(s.nb_inspections, 0) * 100, 1
      ) AS taux_ok
    FROM public.operateur o
    JOIN public.session_operateur s ON s.id_operateur = o.id_operateur
    WHERE s.nb_inspections > 0
    ORDER BY s.nb_inspections DESC
    LIMIT 10
  `);
}

  // ─── ANALYSE PAR LOT ─────────────────────────────────────────

  async getLotsKpis() {
    const result = await this.dataSource.query(`
      SELECT
        COUNT(DISTINCT l.id_lot) AS total_lots,
        COUNT(DISTINCT CASE
          WHEN (
            SELECT COUNT(*) FROM public.piece p2
            JOIN public.inspection i2 ON i2.id_piece = p2.id_piece
            WHERE p2.id_lot = l.id_lot AND i2.resultat = 'NIO'
          )::numeric /
          NULLIF((
            SELECT COUNT(*) FROM public.piece p3
            JOIN public.inspection i3 ON i3.id_piece = p3.id_piece
            WHERE p3.id_lot = l.id_lot
          ), 0) * 100 > 15
          THEN l.id_lot END
        ) AS lots_critiques,
        ROUND(AVG(
          (SELECT COUNT(*) FROM public.piece p4
           JOIN public.inspection i4 ON i4.id_piece = p4.id_piece
           WHERE p4.id_lot = l.id_lot AND i4.resultat = 'NIO')::numeric /
          NULLIF((
            SELECT COUNT(*) FROM public.piece p5
            JOIN public.inspection i5 ON i5.id_piece = p5.id_piece
            WHERE p5.id_lot = l.id_lot
          ), 0) * 100
        ), 1) AS mdr_moyen
      FROM public.lot l
    `);
    return result[0];
  }

  async getLotsList(client?: string, statut?: string, startDate?: string, endDate?: string) {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;
    if (client)    { where += ` AND c.id_client = $${idx++}`;       params.push(client); }
    if (statut)    { where += ` AND l.statut_lot = $${idx++}`;      params.push(statut); }
    if (startDate) { where += ` AND l.date_reception >= $${idx++}`; params.push(startDate); }
    if (endDate)   { where += ` AND l.date_reception <= $${idx++}`; params.push(endDate); }

    return this.dataSource.query(`
      SELECT
        l.id_lot,
        c.nom_client                                           AS client,
        l.date_reception,
        l.statut_lot,
        l.id_lot AS reference_lot,
        COUNT(DISTINCT p.id_piece)                            AS total_pieces,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)        AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      ${where}
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
      ORDER BY l.date_reception DESC
      LIMIT 50
    `, params);
  }

  async getLotsTopProblematic() {
    return this.dataSource.query(`
      SELECT
        l.id_lot,
        c.nom_client                                           AS client,
        l.date_reception,
        l.statut_lot,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        COUNT(i.id_inspection)                                 AS total,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
      HAVING COUNT(i.id_inspection) > 0
      ORDER BY mdr DESC
      LIMIT 5
    `);
  }

  async getLotDetail(idLot: string) {
    const [lot] = await this.dataSource.query(`
      SELECT
        l.id_lot, c.nom_client AS client,
        l.date_reception, l.statut_lot,
        COUNT(DISTINCT p.id_piece)                            AS total_pieces,
        COUNT(CASE WHEN i.resultat = 'OK'  THEN 1 END)        AS ok,
        COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)        AS nio,
        ROUND(
          COUNT(CASE WHEN i.resultat = 'NIO' THEN 1 END)::numeric /
          NULLIF(COUNT(i.id_inspection), 0) * 100, 1
        ) AS mdr
      FROM public.lot l
      JOIN public.client c     ON c.id_client = l.id_client
      LEFT JOIN public.piece p      ON p.id_lot    = l.id_lot
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      WHERE l.id_lot = $1
      GROUP BY l.id_lot, c.nom_client, l.date_reception, l.statut_lot
    `, [idLot]);

    const defects = await this.dataSource.query(`
      SELECT d.type_defaut, d.gravite, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      JOIN public.piece p      ON p.id_piece      = i.id_piece
      WHERE p.id_lot = $1
      GROUP BY d.type_defaut, d.gravite
      ORDER BY total DESC
    `, [idLot]);

    return { ...lot, defects };
  }

  // ─── TRAÇABILITÉ ─────────────────────────────────────────────

  async searchPieces(filters: any) {
    let where = 'WHERE 1=1';
    const params: any[] = [];
    let idx = 1;

    if (filters.q) {
      where += ` AND (p.id_piece::text ILIKE $${idx} OR p.reference_piece ILIKE $${idx})`;
      params.push(`%${filters.q}%`); idx++;
    }
    if (filters.client)    { where += ` AND c.id_client = $${idx++}`;       params.push(filters.client); }
    if (filters.lot)       { where += ` AND l.id_lot ILIKE $${idx++}`;      params.push(`%${filters.lot}%`); }
    if (filters.result)    { where += ` AND i.resultat = $${idx++}`;         params.push(filters.result); }
    if (filters.startDate) { where += ` AND i.date_inspection >= $${idx++}`; params.push(filters.startDate); }
    if (filters.endDate)   { where += ` AND i.date_inspection <= $${idx++}`; params.push(filters.endDate); }

    return this.dataSource.query(`
      SELECT
        p.id_piece,
        p.reference_piece,
        p.nom_piece,
        l.id_lot,
        c.nom_client       AS client,
        i.id_inspection,
        i.date_inspection,
        i.resultat,
        i.confidence,
        i.image_path,
        COUNT(d.id_defaut) AS nb_defauts
      FROM public.piece p
      JOIN public.lot l         ON l.id_lot        = p.id_lot
      JOIN public.client c      ON c.id_client     = l.id_client
      LEFT JOIN public.inspection i ON i.id_piece  = p.id_piece
      LEFT JOIN public.defaut d     ON d.id_inspection = i.id_inspection
      ${where}
      GROUP BY p.id_piece, p.reference_piece, p.nom_piece,
               l.id_lot, c.nom_client, i.id_inspection,
               i.date_inspection, i.resultat, i.confidence, i.image_path
      ORDER BY i.date_inspection DESC
      LIMIT 100
    `, params);
  }

  async getPieceDetail(id: string) {
    const [piece] = await this.dataSource.query(`
      SELECT
        p.id_piece, p.reference_piece, p.nom_piece,
        l.id_lot, l.date_reception, l.statut_lot,
        c.nom_client      AS client,
        i.id_inspection,  i.date_inspection, i.resultat,
        i.confidence,     i.image_path,      i.shap_image_path,
        i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
        i.model_version
      FROM public.piece p
      JOIN public.lot l         ON l.id_lot       = p.id_lot
      JOIN public.client c      ON c.id_client    = l.id_client
      LEFT JOIN public.inspection i ON i.id_piece = p.id_piece
      WHERE p.id_piece = $1
      ORDER BY i.date_inspection DESC
      LIMIT 1
    `, [id]);

    const defauts = await this.dataSource.query(`
      SELECT d.type_defaut, d.gravite, COUNT(*) AS total
      FROM public.defaut d
      JOIN public.inspection i ON i.id_inspection = d.id_inspection
      WHERE i.id_piece = $1
      GROUP BY d.type_defaut, d.gravite
      ORDER BY total DESC
    `, [id]);

    return { ...piece, defauts };
  }

  // ─── IMAGES NIO ──────────────────────────────────────────────

  async getNioImages(filters: any) {
    let where = `WHERE i.resultat = 'NIO' AND i.image_path IS NOT NULL`;
    const params: any[] = [];
    let idx = 1;

    if (filters.client) {
      where += ` AND c.id_client = $${idx++}`;
      params.push(filters.client);
    }
    if (filters.defect) {
      where += ` AND EXISTS (
        SELECT 1 FROM public.defaut d2
        WHERE d2.id_inspection = i.id_inspection
        AND d2.type_defaut = $${idx++})`;
      params.push(filters.defect);
    }
    if (filters.lot) {
      where += ` AND l.id_lot ILIKE $${idx++}`;
      params.push(`%${filters.lot}%`);
    }

    return this.dataSource.query(`
      SELECT
        i.id_inspection,
        i.id_piece,
        p.reference_piece,
        l.id_lot,
        c.nom_client          AS client,
        i.date_inspection,
        i.confidence,
        i.image_path,
        i.shap_image_path,
        STRING_AGG(DISTINCT d.type_defaut, ', ') AS defauts,
        STRING_AGG(DISTINCT d.gravite, ', ')     AS gravites,
        COUNT(d.id_defaut)                       AS nb_defauts
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      LEFT JOIN public.defaut d ON d.id_inspection = i.id_inspection
      ${where}
      GROUP BY i.id_inspection, i.id_piece, p.reference_piece,
               l.id_lot, c.nom_client, i.date_inspection,
               i.confidence, i.image_path, i.shap_image_path
      ORDER BY i.date_inspection DESC
      LIMIT 200
    `, params);
  }

  async getNioImageDetail(id: string) {
    const [inspection] = await this.dataSource.query(`
      SELECT
        i.id_inspection, i.id_piece,
        p.reference_piece, p.nom_piece,
        l.id_lot, l.date_reception,
        c.nom_client AS client,
        i.date_inspection, i.resultat, i.confidence,
        i.image_path, i.shap_image_path,
        i.bbox_x, i.bbox_y, i.bbox_w, i.bbox_h,
        i.model_version
      FROM public.inspection i
      JOIN public.piece p  ON p.id_piece  = i.id_piece
      JOIN public.lot l    ON l.id_lot    = p.id_lot
      JOIN public.client c ON c.id_client = l.id_client
      WHERE i.id_inspection = $1
    `, [id]);

    const defauts = await this.dataSource.query(`
      SELECT type_defaut, gravite
      FROM public.defaut
      WHERE id_inspection = $1
      ORDER BY gravite DESC
    `, [id]);

    return { ...inspection, defauts };
  }

  // ─── RAPPORT ─────────────────────────────────────────────────

  async getPieceRapport(id: string) {
    return this.getPieceDetail(id);
  }
private imageToBase64(imagePath: string): string {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return '';
    const imageBuffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase().replace('.', '');
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  } catch (e) {
    return '';
  }
}
  async sendRapportMail(pieceId: string, email: string) {

  // ── 1. Vérifier que l'email existe en base ───────────────────
  const userExists = await this.dataSource.query(
    `SELECT id FROM public.users WHERE email = $1 AND is_active = true LIMIT 1`,
    [email]
  );
  if (!userExists || userExists.length === 0) {
    throw new Error(`L'adresse email "${email}" n'est pas déclarée dans le système`);
  }

  // ── 2. Récupérer les données du rapport ──────────────────────
  const rapport = await this.getPieceRapport(pieceId);
  const defauts = rapport.defauts || [];



// Convertir images en base64
const imageBase64     = this.imageToBase64(rapport.image_path);
const shapBase64      = this.imageToBase64(rapport.shap_image_path);
  // ── 3. Générer HTML du rapport ───────────────────────────────
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; margin: 40px; }
        .header { background: #1a2744; color: white; padding: 20px; border-radius: 8px; display: flex; justify-content: space-between; }
        .brand { font-size: 16px; font-weight: bold; }
        .sub { font-size: 12px; color: #aaa; margin-top: 4px; }
        .meta { text-align: right; font-size: 12px; line-height: 1.8; }
        .section { margin-top: 24px; border: 1px solid #e0e0e0; border-radius: 8px; overflow: hidden; }
        .section-title { background: #f5f5f5; padding: 10px 16px; font-weight: bold; font-size: 14px; display: flex; align-items: center; gap: 8px; }
        .num { background: #1a2744; color: white; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; }
        .info-row { display: flex; justify-content: space-between; padding: 10px 16px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        .info-key { color: #888; }
        .info-val { font-weight: 600; }
        .badge-bmw { background: #dbeafe; color: #1d4ed8; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }
        .ai-block { padding: 16px; display: flex; gap: 24px; align-items: flex-start; }
        .result-badge { padding: 12px 20px; border-radius: 8px; font-size: 20px; font-weight: bold; text-align: center; min-width: 120px; }
        .badge-nio { background: #fee2e2; color: #dc2626; }
        .badge-io  { background: #dcfce7; color: #16a34a; }
        .ai-meta { font-size: 13px; }
        .ai-meta-row { display: flex; gap: 12px; padding: 4px 0; border-bottom: 1px solid #f0f0f0; }
        .ai-meta-row span { color: #888; min-width: 140px; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #f5f5f5; padding: 10px; text-align: left; font-weight: 600; }
        td { padding: 10px; border-bottom: 1px solid #f0f0f0; }
        .sev-high { background: #fee2e2; color: #dc2626; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
        .sev-med  { background: #fef3c7; color: #d97706; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
        .sev-low  { background: #dcfce7; color: #16a34a; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
        .ok-msg { display: flex; align-items: center; gap: 12px; padding: 20px; color: #16a34a; font-size: 14px; }
        .footer { text-align: center; font-size: 11px; color: #aaa; margin-top: 30px; padding-top: 16px; border-top: 1px solid #e0e0e0; display: flex; justify-content: space-between; }
      </style>
    </head>
    <body>

      <div class="header">
        <div>
          <div class="brand">CuirQuality · DRÄXLMAIER</div>
          <div class="sub">Système de contrôle qualité cuir — LeatherGuard AI</div>
        </div>
        <div class="meta">
          <div>N° Rapport : <strong>RPT-${rapport.id_inspection}</strong></div>
          <div>Date : <strong>${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></div>
          <div>Résultat : <strong>${rapport.resultat}</strong></div>
        </div>
      </div>

      <div class="section">
        <div class="section-title"><span class="num">1</span> Identité de la pièce</div>
        <div class="info-row"><span class="info-key">Référence pièce</span><span class="info-val">${rapport.reference_piece || rapport.id_piece}</span></div>
        <div class="info-row"><span class="info-key">Nom pièce</span><span class="info-val">${rapport.nom_piece || '—'}</span></div>
        <div class="info-row"><span class="info-key">Client</span><span class="info-val"><span class="badge-bmw">${rapport.client}</span></span></div>
      </div>

      <div class="section">
        <div class="section-title"><span class="num">2</span> Traçabilité du lot</div>
        <div class="info-row"><span class="info-key">ID Lot</span><span class="info-val">${rapport.id_lot}</span></div>
        <div class="info-row"><span class="info-key">Date réception</span><span class="info-val">${rapport.date_reception ? new Date(rapport.date_reception).toLocaleDateString('fr-FR') : '—'}</span></div>
        <div class="info-row"><span class="info-key">Statut lot</span><span class="info-val">${rapport.statut_lot || '—'}</span></div>
      </div>

      <div class="section">
        <div class="section-title"><span class="num">3</span> Résultat d'inspection — LeatherGuard AI</div>
        <div class="ai-block">
          <div class="result-badge ${rapport.resultat === 'IO' ? 'badge-io' : 'badge-nio'}">
            ${rapport.resultat === 'IO' ? '✅ IO' : '❌ NIO'}
          </div>
          <div class="ai-meta">
            <div class="ai-meta-row"><span>Date inspection</span><strong>${rapport.date_inspection ? new Date(rapport.date_inspection).toLocaleString('fr-FR') : '—'}</strong></div>
            <div class="ai-meta-row"><span>Confiance modèle</span><strong>${rapport.confidence ? (rapport.confidence * 100).toFixed(1) + '%' : '—'}</strong></div>
            <div class="ai-meta-row"><span>Version modèle</span><strong>${rapport.model_version || '—'}</strong></div>
          </div>
        </div>
      </div>

      ${rapport.resultat === 'NIO' && defauts.length > 0 ? `
      <div class="section">
        <div class="section-title"><span class="num">4</span> Défauts détectés</div>
        <table>
          <thead><tr><th>#</th><th>Type de défaut</th><th>Gravité</th></tr></thead>
          <tbody>
            ${defauts.map((d: any, i: number) => `
              <tr>
                <td>${i + 1}</td>
                <td>${d.type_defaut}</td>
                <td><span class="${d.gravite === 'Critique' ? 'sev-high' : d.gravite === 'Majeure' ? 'sev-med' : 'sev-low'}">${d.gravite}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>` : `
      <div class="section">
        <div class="section-title"><span class="num">4</span> Résultat de conformité</div>
        <div class="ok-msg">✅ Pièce conforme — aucun défaut détecté</div>
      </div>`}

      <div class="footer">
        <span>DRÄXLMAIER Group · Système LeatherGuard AI · Rapport généré automatiquement</span>
        <span>${new Date().toLocaleDateString('fr-FR')}</span>
      </div>

    </body>
    </html>
  `;

  // ── 4. Générer PDF avec puppeteer ────────────────────────────
  const puppeteer = require('puppeteer');
  const browser   = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format : 'A4',
    margin : { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    printBackground: true,
  });
  await browser.close();

  // ── 5. Envoyer mail avec PDF en pièce jointe ─────────────────
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: 587,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  await transporter.sendMail({
    from   : `"LeatherGuard AI — DRÄXLMAIER" <${process.env.SMTP_USER}>`,
    to     : email,
    subject: `Rapport d'inspection — Pièce ${rapport.reference_piece || rapport.id_piece}`,
    html   : `
      <p>Bonjour,</p>
      <p>Veuillez trouver ci-joint le rapport d'inspection de la pièce
         <strong>${rapport.reference_piece || rapport.id_piece}</strong>
         généré automatiquement par le système LeatherGuard AI.</p>
      <p>Résultat : <strong>${rapport.resultat}</strong></p>
      <p>Cordialement,<br/>Système LeatherGuard AI — DRÄXLMAIER UATS Sousse</p>
    `,
    attachments: [{
      filename   : `rapport_${rapport.reference_piece || rapport.id_piece}.pdf`,
      content    : pdfBuffer,
      contentType: 'application/pdf',
    }],
  });

  return { success: true, message: `Rapport envoyé à ${email}` };
}

async getDefectsKpis(filters: any) {
  let where = 'WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (filters.client)    { where += ` AND c.id_client = $${idx++}`;       params.push(filters.client); }
  if (filters.defect)    { where += ` AND d.type_defaut = $${idx++}`;     params.push(filters.defect); }
  if (filters.severity)  { where += ` AND d.gravite = $${idx++}`;         params.push(filters.severity); }
  if (filters.startDate) { where += ` AND i.date_inspection >= $${idx++}`; params.push(filters.startDate); }
  if (filters.endDate)   { where += ` AND i.date_inspection <= $${idx++}`; params.push(filters.endDate); }

  const result = await this.dataSource.query(`
    SELECT
      COUNT(d.id_defaut)::int                          AS total_defects,
      COUNT(DISTINCT p.id_lot)::int                    AS impacted_lots,
      (
        SELECT d2.type_defaut
        FROM public.defaut d2
        JOIN public.inspection i2 ON i2.id_inspection = d2.id_inspection
        JOIN public.piece p2      ON p2.id_piece      = i2.id_piece
        JOIN public.lot l2        ON l2.id_lot        = p2.id_lot
        JOIN public.client c2     ON c2.id_client     = l2.id_client
        GROUP BY d2.type_defaut
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS dominant_defect,
      (
        SELECT d3.gravite
        FROM public.defaut d3
        JOIN public.inspection i3 ON i3.id_inspection = d3.id_inspection
        JOIN public.piece p3      ON p3.id_piece      = i3.id_piece
        JOIN public.lot l3        ON l3.id_lot        = p3.id_lot
        JOIN public.client c3     ON c3.id_client     = l3.id_client
        GROUP BY d3.gravite
        ORDER BY COUNT(*) DESC
        LIMIT 1
      ) AS dominant_severity
    FROM public.defaut d
    JOIN public.inspection i ON i.id_inspection = d.id_inspection
    JOIN public.piece p      ON p.id_piece      = i.id_piece
    JOIN public.lot l        ON l.id_lot        = p.id_lot
    JOIN public.client c     ON c.id_client     = l.id_client
    ${where}
  `, params);

  const row = result[0];
  return {
    total_defects    : row.total_defects    || 0,
    dominant_defect  : row.dominant_defect  || '—',
    dominant_severity: row.dominant_severity || '—',
    impacted_lots    : row.impacted_lots    || 0,
  };
}


async getDefectsBySeverity() {
  return this.dataSource.query(`
    SELECT
      d.gravite,
      COUNT(*) AS total
    FROM public.defaut d
    GROUP BY d.gravite
    ORDER BY total DESC
  `);
}

async getDefectsTrend() {
  return this.dataSource.query(`
    SELECT
      TO_CHAR(i.date_inspection, 'DD/MM') AS date,
      COUNT(d.id_defaut) AS total,
      COUNT(CASE WHEN d.type_defaut = 'scar'    THEN 1 END) AS scar,
      COUNT(CASE WHEN d.type_defaut = 'wrinkle' THEN 1 END) AS wrinkle
    FROM public.inspection i
    JOIN public.defaut d ON d.id_inspection = i.id_inspection
    GROUP BY TO_CHAR(i.date_inspection, 'DD/MM'),
             DATE_TRUNC('day', i.date_inspection)
    ORDER BY DATE_TRUNC('day', i.date_inspection) DESC
    LIMIT 14
  `);
}

async getTopDefectsLots() {
  return this.dataSource.query(`
    SELECT
      l.id_lot           AS lot,
      c.nom_client       AS client,
      d.type_defaut      AS type_defaut,
      COUNT(d.id_defaut) AS total
    FROM public.lot l
    JOIN public.client c      ON c.id_client     = l.id_client
    JOIN public.piece p       ON p.id_lot        = l.id_lot
    JOIN public.inspection i  ON i.id_piece      = p.id_piece
    JOIN public.defaut d      ON d.id_inspection = i.id_inspection
    GROUP BY l.id_lot, c.nom_client, d.type_defaut
    ORDER BY total DESC
    LIMIT 5
  `);
}


async createLot(body: any) {
  await this.dataSource.query(
    `INSERT INTO public.lot (id_lot, id_client, date_reception, statut_lot)
     VALUES ($1, $2, $3, $4)`,
    [body.id_lot, body.id_client, body.date_reception, body.statut_lot || 'EN_COURS']
  );
  return { success: true, id_lot: body.id_lot };
}

async updateLot(id: string, body: any) {
  await this.dataSource.query(
    `UPDATE public.lot 
     SET statut_lot = $1, date_reception = $2
     WHERE id_lot = $3`,
    [body.statut_lot, body.date_reception, id]
  );
  return { success: true };
}

async deleteLot(id: string) {
  await this.dataSource.query(
    `DELETE FROM public.lot WHERE id_lot = $1`,
    [id]
  );
  return { success: true };
}








}
















