import { Controller, Get,Query  } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import {Param } from '@nestjs/common';

import { Post, Body } from '@nestjs/common';


@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('kpis')
  getKpis() {
    return this.dashboardService.getKpis();
  }
  @Get('inspections-trend')
getInspectionsTrend() {
  return this.dashboardService.getInspectionsTrend();
}

@Get('top-lots')
getTopLots() {
  return this.dashboardService.getTopLots();
}
@Get('defects-distribution')
getDefectsDistribution() {
  return this.dashboardService.getDefectsDistribution();
}

@Get('kpis-filtered')
getKpisFiltered(@Query() query) {
  return this.dashboardService.getKpisFiltered(query);
}

// Ajouter dans src/dashboard/dashboard.controller.ts

  // ─── Performances ───────────────────────────────
  @Get('perf-kpis')
  getPerfKpis() { return this.dashboardService.getPerfKpis(); }

  @Get('perf-trend')
  getPerfTrend() { return this.dashboardService.getPerfTrend(); }

  @Get('perf-by-client')
  getPerfByClient() { return this.dashboardService.getPerfByClient(); }

  @Get('perf-by-operatrice')
  getPerfByOperatrice() { return this.dashboardService.getPerfByOperatrice(); }

  // ─── Lots ────────────────────────────────────────
  @Get('lots-kpis')
  getLotsKpis() { return this.dashboardService.getLotsKpis(); }

  @Get('lots-list')
  getLotsList(
    @Query('client')    client?: string,
    @Query('statut')    statut?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate')   endDate?: string,
  ) {
    return this.dashboardService.getLotsList(client, statut, startDate, endDate);
  }

  @Get('lots-top-problematic')
  getLotsTopProblematic() { return this.dashboardService.getLotsTopProblematic(); }

  @Get('lot-detail/:id')
  getLotDetail(@Param('id') id: string) { return this.dashboardService.getLotDetail(id); }


  // ─── Traçabilité ──────────────────────────────────────
@Get('traceability/search')
searchPieces(
  @Query('q')         q?: string,
  @Query('client')    client?: string,
  @Query('lot')       lot?: string,
  @Query('result')    result?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate')   endDate?: string,
) {
  return this.dashboardService.searchPieces({ q, client, lot, result, startDate, endDate });
}
@Get('traceability/piece/:id')
getPieceDetail(@Param('id') id: string) {
  return this.dashboardService.getPieceDetail(id);
}

// ─── Images NIO ───────────────────────────────────────
@Get('nio-images')
getNioImages(
  @Query('client')   client?: string,
  @Query('defect')   defect?: string,
  @Query('severity') severity?: string,
  @Query('lot')      lot?: string,
) {
  return this.dashboardService.getNioImages({ client, defect, severity, lot });
}
@Get('nio-images/:id')
getNioImageDetail(@Param('id') id: string) {
  return this.dashboardService.getNioImageDetail(id);
}

// ─── Rapport ──────────────────────────────────────────
@Get('rapport/piece/:id')
getPieceRapport(@Param('id') id: string) {
  return this.dashboardService.getPieceRapport(id);
}

@Post('rapport/send-mail')
async sendRapportMail(@Body() body: { pieceId: string; email: string }) {
  return this.dashboardService.sendRapportMail(body.pieceId, body.email);
}




}
