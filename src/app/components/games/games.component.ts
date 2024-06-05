import { Component } from '@angular/core';

import { OnInit } from '@angular/core';
import Phaser from 'phaser';
import { EventBus } from './demo-game-space/event-bus';
import StartGame from './demo-game-space/main';

@Component({
  selector: 'app-game-shell',
  template: '<div id="game-container"></div>',
  standalone: true,
})
export class GameShellComponent implements OnInit {
  scene: Phaser.Scene;
  game: Phaser.Game;

  sceneCallback: (scene: Phaser.Scene) => void;

  ngOnInit() {
    this.game = StartGame('game-container');

    EventBus.on('current-scene-ready', (scene: Phaser.Scene) => {
      this.scene = scene;

      if (this.sceneCallback) {
        this.sceneCallback(scene);
      }
    });
  }

  // Component unmounted
  ngOnDestroy() {
    if (this.game) {
      this.game.destroy(true);
    }
  }
}
