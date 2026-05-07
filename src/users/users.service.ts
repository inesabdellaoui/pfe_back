import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from './user.entity';

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

    if (!user) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const { passwordHash, ...safeUser } = user;
    return safeUser;
  }
}