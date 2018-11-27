const RequestHelper = require('../helpers/request_helper.js');
const PubSub = require("../helpers/pub_sub.js");

const Game = function () {
  this.newDeckUrl = 'https://deckofcardsapi.com/api/deck/new/shuffle/?deck_count=6';
  this.requestDeck = new RequestHelper(this.newDeckUrl);
  this.roundObject = {};
  this.playerWinCount = 0;
  this.dealerWinCount = 0;
};

Game.prototype.bindEvents = function () {
  const shuffleDeckButton = document.querySelector("#shuffle-deck-button");
  shuffleDeckButton.addEventListener("click", () => {
    this.getShuffledDeck();
  });

  PubSub.subscribe("ResultView:auto-redeal", () => {
    const dealerTotalBox = document.querySelector('div#dealer_total');
    dealerTotalBox.innerHTML = "";
    this.dealCards(this.deckId);

    const totalTextBox = document.querySelector("div#total_text_container")
    totalTextBox.innerHTML = "";
  });

  PubSub.subscribe("ResultView:hit-button-click", () => {
    this.drawOneCard(this.roundObject.playerCards, `player`)
    this.playCardSound();
  });

  PubSub.subscribe("ResultView:stick-button-click", () => {
    PubSub.publish(`Game:dealer-drawn-card-ready`, this.roundObject.dealerCards);
    setTimeout(() => {
      this.renderDealerAction(this.roundObject.dealerCards);
    }, 300);

  });

};

// start of game, new shuffled 6 deck & initial deal
Game.prototype.getShuffledDeck = function () {
  this.playerWinCount = 0;
  this.dealerWinCount = 0;
  PubSub.publish("Game:player_win_count", this.playerWinCount);
  PubSub.publish("Game:dealer_win_count", this.dealerWinCount);
  this.requestDeck.get()
    .then((shuffledDeck) => {
      this.newCardsUrl = `https://deckofcardsapi.com/api/deck/${ shuffledDeck.deck_id }/draw/?count=2`;
      this.deckId = shuffledDeck.deck_id;
      return shuffledDeck.deck_id;
    })
    .then((deckId) => {
      this.dealCards(deckId);
    })
};

// initial deal - two cards each, first dealer card hidden
Game.prototype.dealCards = function (deckId) {
  this.requestCards = new RequestHelper(this.newCardsUrl);
  this.requestCards.get()
    .then((drawnCards) => {
      this.convert(drawnCards.cards);
      this.roundObject.dealerCards = drawnCards.cards;
      PubSub.publish("Game:dealer-cards-ready", this.roundObject.dealerCards);
    })
    .then(() => {
      this.requestCards.get()
        .then((drawnCards) => {
          this.convert(drawnCards.cards);
          this.roundObject.playerCards = drawnCards.cards;
          PubSub.publish("Game:player-cards-ready", this.roundObject.playerCards);
          const playerTotal = this.getHandTotal(this.roundObject.playerCards);
          PubSub.publish("Game:player-total", playerTotal);
          this.blackJackChecker(this.roundObject);
          this.bustChecker(this.roundObject);
        })
    });
};

// an actor draws one card into their card array
Game.prototype.drawOneCard = function (array, actor) {
  this.drawOneUrl = `https://deckofcardsapi.com/api/deck/${ this.deckId }/draw/?count=1`;
  this.requestOneCard = new RequestHelper(this.drawOneUrl);
  this.requestOneCard.get()
    .then((cardObject) => {
      this.convert(cardObject.cards);
      array.push(cardObject.cards[0]);

      const playerTotal = this.getHandTotal(this.roundObject.playerCards)

      // IS THIS WHERE WE WERE TRYING TO INJECT THE ACTOR TO MAKE FUNCTION REUSABLE?
      PubSub.publish("Game:player-total", playerTotal);
      PubSub.publish(`Game:${ actor }-drawn-card-ready`, array);
      this.bustChecker(this.roundObject);
      return array;
    })
    .then((array) => {
      if (actor == `dealer`) {
        setTimeout(() => {
          this.renderDealerAction(array)
        }, 300);
      }
    })
};

// triggered after player 'sticks' and recurrs if condition true
Game.prototype.renderDealerAction = function (array) {
  // CAN BE REFACTORED:
  const dealerTotal = this.getHandTotal(this.roundObject.dealerCards)
  PubSub.publish("Game:dealer-total", dealerTotal);

  if ((this.getHandTotal(array) <= 16) && (this.getHandTotal(array) <= this.getHandTotal(this.roundObject.playerCards) )) {
    setTimeout(() => {
      this.drawOneCard(array, `dealer`)
      this.playCardSound();
    }, 300);
  }
  else if (this.getHandTotal(array) > 21) {
    //this is supposed to be empty, so if the dealer goes bust, this.getResult is not called in the line below
  }
  else {
    setTimeout(() => {
      this.getResult(this.roundObject)
    }, 300);
  }
};

// converts picture cards and ace values as cards dealt/drawn
Game.prototype.convert = function (drawnCards) {
  drawnCards.forEach((cardObject) => {
    if ((cardObject.value === "JACK") || (cardObject.value === "QUEEN") || (cardObject.value === "KING")) {
      cardObject.value = "10";
    }
    else if (cardObject.value === "ACE") {
      cardObject.value = "11";
    }
  });
};

// determines win/draw/bust and publishes result
Game.prototype.getResult = function (roundObject) {
  const playerTotal = this.getHandTotal(roundObject.playerCards)
  const dealerTotal = this.getHandTotal(roundObject.dealerCards)

  PubSub.publish("Game:player-total", playerTotal);
  PubSub.publish("Game:dealer-total", dealerTotal);

  whoWon = "";

  if (playerTotal > 21) {
    whoWon = "You went Bust! Dealer wins!"
    this.playLoseSound();
    this.dealerWinCount += 1;
  }
  else if (dealerTotal > 21) {
    whoWon = "Dealer went Bust! You win!"
    this.playWinSound();
    this.playerWinCount += 1;
  }
  else if (dealerTotal > playerTotal) {
    whoWon = "Dealer wins!"
    this.playLoseSound();
    this.dealerWinCount += 1;
  }
  else if (playerTotal > dealerTotal) {
    whoWon = "You win!";
    this.playWinSound();
    this.playerWinCount += 1;
  }
  else {
    whoWon = "It's a draw!"
  }

  PubSub.publish("Game:result-loaded", whoWon);
//------------------------------------------------------------
  PubSub.publish("Game:player_win_count", this.playerWinCount);
  PubSub.publish("Game:dealer_win_count", this.dealerWinCount);
//-------------------------------------------------------------
};

Game.prototype.getHandTotal = function (array) {
  total = 0;
  array.forEach((card) => {
    total += Number(card.value)
  });
  return total;
};

// checks for Blackjack upon initial deal
Game.prototype.blackJackChecker = function (roundObject) {
  const playerTotal = this.getHandTotal(roundObject.playerCards)
  const dealerTotal = this.getHandTotal(roundObject.dealerCards)
  if ((playerTotal == 21) || (dealerTotal == 21)) {

    PubSub.publish("Game:dealer-total", dealerTotal);
    this.getResult(roundObject);
    // show dealer's hidden card if anyone has Blackjack:
    PubSub.publish(`Game:dealer-drawn-card-ready`, this.roundObject.dealerCards);
  }
  else {
    this.renderChoice(roundObject);
  }
};

// if no Blackjack, player given choice to hit/stick
Game.prototype.renderChoice = function (roundObject) {
  PubSub.publish("Game:choice-loaded");
}

// triggered each time card drawn:
Game.prototype.bustChecker = function (roundObject) {
  if (this.getHandTotal(roundObject.playerCards) > 21) {
    setTimeout(() => {
      this.checkForEleven(roundObject.playerCards)
    }, 300);
  }
  else if (this.getHandTotal(roundObject.dealerCards) > 21) {
    setTimeout(() => {
      this.checkForEleven(roundObject.dealerCards)
    }, 300);
  }
};

// handling ace value being 1 or 11:
Game.prototype.checkForEleven = function (cards) {

  const elevenCard = cards.find( card => card.value == "11");
  if (elevenCard != undefined) {
    elevenCard.value = "1"
    const playerTotal = this.getHandTotal(this.roundObject.playerCards);
    PubSub.publish("Game:player-total", playerTotal);
  }
  else {
    PubSub.publish(`Game:dealer-drawn-card-ready`, this.roundObject.dealerCards);
    setTimeout(() => {
      this.getResult(this.roundObject);
    }, 300);
  };
};

Game.prototype.playCardSound = function () {
  var sound = new Audio("/sound/cardPlace4.wav");
  sound.play()
};

Game.prototype.playWinSound = function () {
  var sound = new Audio("/sound/youwin.wav");
  sound.play()
};

Game.prototype.playLoseSound = function () {
  var sound = new Audio("/sound/youlose.wav");
  sound.play()
};


module.exports = Game;
