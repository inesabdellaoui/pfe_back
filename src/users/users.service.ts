import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.usersRepository.findOne({
      where: { email, isActive: true },
    });
  }

  findById(id: string) {
    return this.usersRepository.findOne({
      where: { id, isActive: true },
    });
  }

  async getProfile(id: string) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }

  findAll() {
    return this.usersRepository.find({
      select: ['id', 'nom', 'prenom', 'email', 'role', 'isActive', 'createdAt']
    });
  }

  async create(body: any) {
    const hash = await bcrypt.hash(body.password, 10);
    const role = body.role?.toLowerCase();
    const user = this.usersRepository.create({
      nom          : body.nom,
      prenom       : body.prenom,
      email        : body.email,
      role         : role,
      passwordHash : hash,
      isActive     : body.isActive ?? true,
      createdAt    : new Date(),
      updatedAt    : new Date(),
    });
    return this.usersRepository.save(user);
  }

  async update(id: string, body: any) {
    const updateData: any = {
      nom      : body.nom,
      prenom   : body.prenom,
      email    : body.email,
      role     : body.role?.toLowerCase(),
      isActive : body.isActive,
      updatedAt: new Date(),
    };
    if (body.password) {
      updateData.passwordHash = await bcrypt.hash(body.password, 10);
    }
    await this.usersRepository.update(id, updateData);
    return this.usersRepository.findOne({
      where : { id },
      select: ['id', 'nom', 'prenom', 'email', 'role', 'isActive']
    });
  }

  async delete(id: string) {
    await this.usersRepository.delete(id);
    return { success: true };
  }
}