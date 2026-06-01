import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { HmiService } from './hmi.service';

@Controller('api/hmi')
export class HmiController {

  constructor(private readonly hmiService: HmiService) {}

  // ── Login opérateur ───────────────────────────────────────────
  @Post('login')
  async login(@Body() body: { matricule: string }) {
    return this.hmiService.loginOperateur(body.matricule);
  }

  // ── Scan lot ──────────────────────────────────────────────────
  @Post('scan-lot')
  async scanLot(@Body() body: {
    id_lot       : string,
    id_operateur : number,
    id_session   : number
  }) {
    return this.hmiService.scanLot(body);
  }

  // ── Scan grande pièce ─────────────────────────────────────────
  @Post('scan-grande-piece')
  async scanGrandePiece(@Body() body: {
    qr_code      : string,
    id_lot       : string,
    id_session   : number
  }) {
    return this.hmiService.scanGrandePiece(body);
  }

  // ── Inspection automatique ────────────────────────────────────
  @Post('inspection-auto')
  async inspectionAuto(@Body() body: {
    id_piece        : string,
    id_grande_piece : string,
    id_lot          : string,
    id_operateur    : number,
    id_session      : number,
    image_base64    : string
  }) {
    return this.hmiService.inspectionAuto(body);
  }

  // ── Résumé lot ────────────────────────────────────────────────
  @Get('lot-summary/:id_lot')
  async lotSummary(@Param('id_lot') id_lot: string) {
    return this.hmiService.getLotSummary(id_lot);
  }

  // ── Fin grande pièce ──────────────────────────────────────────
  @Post('fin-grande-piece')
  async finGrandePiece(@Body() body: {
    id_grande_piece : string
  }) {
    return this.hmiService.finGrandePiece(body.id_grande_piece);
  }

  // ── Logout ────────────────────────────────────────────────────
  @Post('logout')
  async logout(@Body() body: { id_session: number }) {
    return this.hmiService.logoutOperateur(body.id_session);
  }
}