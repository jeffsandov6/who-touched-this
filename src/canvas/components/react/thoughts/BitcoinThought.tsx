import localBitcoins2015 from "../../../assets/thoughts/bitcoin/localbitcoins-2015.png";
import localBitcoins2016 from "../../../assets/thoughts/bitcoin/localbitcoins-2016.png";
import localBitcoins2016To2018 from "../../../assets/thoughts/bitcoin/localbitcoins-2016-2018.png";

export default function BitcoinThought() {
    return (
        <details className="drunk-thought bitcoin-thought">
            <summary className="drunk-thought__summary">
                a quick thought on btc
            </summary>

            <div className="bitcoin-thought__content">
                <figure className="bitcoin-thought__archive">
                    <div className="bitcoin-thought__screenshots">
                        <a
                            href={localBitcoins2015.src}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View full LocalBitcoins 2015 transaction screenshot"
                        >
                            <img
                                className="bitcoin-thought__screenshot bitcoin-thought__screenshot--2015"
                                src={localBitcoins2015.src}
                                alt="LocalBitcoins transaction history from 2015"
                            />
                        </a>

                        <a
                            href={localBitcoins2016.src}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View full LocalBitcoins 2016 transaction screenshot"
                        >
                            <img
                                className="bitcoin-thought__screenshot bitcoin-thought__screenshot--2016"
                                src={localBitcoins2016.src}
                                alt="LocalBitcoins transaction history from 2016"
                            />
                        </a>

                        <a
                            href={localBitcoins2016To2018.src}
                            target="_blank"
                            rel="noreferrer"
                            aria-label="View full LocalBitcoins 2016 through 2018 transaction screenshot"
                        >
                            <img
                                className="bitcoin-thought__screenshot bitcoin-thought__screenshot--2016-2018"
                                src={localBitcoins2016To2018.src}
                                alt="LocalBitcoins transaction history from 2016 through 2018"
                            />
                        </a>
                    </div>

                </figure>

                <div className="bitcoin-thought__copy">
                    <p>
                        btc will likely never become a "currency" in the general sense
                        because nobody uses it as currency, they only use it for
                        speculation. even the biggest btc "fans" dont believe in it as a
                        currency. they push it because they want it to be worth more. &amp;
                        how could something with that much instability ever be used as a
                        reliable vehicle of trade?
                    </p>

                    <p>
                        i first discovered btc in 2015 (screenshot attached). shoutout
                        localbitcoins (rip), iykyk. at the time, i truly believed this was
                        the future. that btc would eventually become a viable currency (how wrong i was). in
                        fact, i bought things using btc.
                    </p>

                    <p>
                        at one point, i had around 7 total btc, but i spent all of it. of
                        course, had i kept it, i would have made a considerable sum of money.
                        but i didn't see it like that (don't get me wrong, in hindsight, i wish i had).
                    </p>

                    <p>
                        you cant claim to believe in something if you're not willing to use
                        it. the problem was, as its value kept growing, people saw it as a
                        get rich quick scheme (& some people did get rich).
                    </p>

                    <p>
                        it never became a viable currency, nor will it ever, because nobody
                        who owns btc is willing to spend it on goods, like we do with fiat.
                        they want to hold it & hope it becomes worth more.
                    </p>

                    <p>satoshi's vision was corrupted.</p>

                    <p className="bitcoin-thought__monero">
                        i then turned to monero.
                    </p>
                </div>
            </div>
        </details>
    );
}