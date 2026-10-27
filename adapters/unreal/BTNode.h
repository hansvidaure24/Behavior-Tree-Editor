#pragma once

#include "CoreMinimal.h"

class UBlackboard;

UENUM(BlueprintType)
enum class EBTNodeStatus : uint8
{
	Success,
	Failure,
	Running
};

UCLASS(Abstract)
class UBTNode : public UObject
{
	GENERATED_BODY()
public:
	UPROPERTY() FString NodeId;
	UPROPERTY() FString NodeName;
	UPROPERTY() TMap<FString, FString> Parameters;
	UPROPERTY() TArray<UBTNode*> Children;

	EBTNodeStatus LastStatus = EBTNodeStatus::Failure;

	EBTNodeStatus Tick(UBlackboard* Bb)
	{
		LastStatus = OnTick(Bb);
		return LastStatus;
	}

protected:
	virtual EBTNodeStatus OnTick(UBlackboard* Bb) { return EBTNodeStatus::Failure; }
};
