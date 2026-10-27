#pragma once

#include "CoreMinimal.h"

UCLASS()
class UBlackboard : public UObject
{
	GENERATED_BODY()
public:
	void Set(const FString& Key, const FString& Value) { Data.Add(Key, Value); }

	FString Get(const FString& Key, const FString& Fallback = TEXT("")) const
	{
		const FString* Val = Data.Find(Key);
		return Val ? *Val : Fallback;
	}

	bool Has(const FString& Key) const { return Data.Contains(Key); }
	void Remove(const FString& Key) { Data.Remove(Key); }
	void Clear() { Data.Empty(); }
	const TMap<FString, FString>& All() const { return Data; }

private:
	UPROPERTY() TMap<FString, FString> Data;
};
